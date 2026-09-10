/**
 * AST detectors for the LLM inventory scan.
 *
 * Detection runs over a TypeScript syntax tree rather than over raw lines
 * because the questions being asked are syntactic ones: is this specifier an
 * import, is this identifier a callee, is this text a string literal or the
 * inside of a comment. A line-based scan answers all three wrongly, and the
 * cost of a wrong answer here is a false negative in an audit whose whole
 * acceptance gate is "zero false negatives".
 *
 * Every file type in scope is parseable by the TypeScript parser (TS, TSX and
 * plain JS/ESM alike), so there is no line-based fallback path to document.
 *
 * @module scripts/inventory/detectors
 */

import ts from "typescript";

import {
  detectAdapterSignals,
  detectFeatures,
  type SourceMarkers,
} from "./capabilities";
import {
  LLM_CALL_EXPRESSIONS,
  LLM_SURFACE_SYMBOLS,
  LUMIC_LLM_ENTRY_SYMBOLS,
  LUMIC_MODULE,
  MODEL_LITERAL_PATTERNS,
  NON_MODEL_TRAILING_SEGMENTS,
  SDK_CONSTRUCTORS,
  UNQUALIFIED_LLM_CALL_NAMES,
  VENDOR_SDK_MODULES,
} from "./detector-config";
import type {
  AnchorKind,
  DetectedAnchor,
  DetectorConfig,
  FileScanResult,
} from "./types";

/** Inputs for scanning one source file. */
export interface ScanSourceInput {
  /** Repository name the file belongs to. */
  readonly repo: string;
  /** POSIX path of the file, relative to the repo root. */
  readonly path: string;
  /** Full text of the file. */
  readonly source: string;
  /** Route-table-derived detector config. */
  readonly config: DetectorConfig;
}

/**
 * True when a module specifier reaches a vendor SDK.
 *
 * Subpath imports count: `openai/resources/chat` couples the file to the same
 * vendor wire format that the root import does.
 *
 * @param specifier - The module specifier text.
 * @returns Whether the specifier names a vendor SDK or one of its subpaths.
 */
export function isVendorSdkModule(specifier: string): boolean {
  return VENDOR_SDK_MODULES.some(
    (module) => specifier === module || specifier.startsWith(`${module}/`),
  );
}

/**
 * True when a string literal is a vendor model identifier.
 *
 * @param literal - The literal's text.
 * @returns Whether the text matches a known vendor model family.
 */
export function isVendorModelLiteral(literal: string): boolean {
  if (!MODEL_LITERAL_PATTERNS.some((pattern) => pattern.test(literal))) {
    return false;
  }
  const segments = literal.toLowerCase().split("-");
  const trailing = segments[segments.length - 1];
  return !NON_MODEL_TRAILING_SEGMENTS.includes(trailing);
}

/** Reconstruct a dotted callee path (`lumic.llm.call`) from an expression, when it is one. */
function dottedName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const left = dottedName(expression.expression);
    return left === undefined ? undefined : `${left}.${expression.name.text}`;
  }
  return undefined;
}

/** Collect the named bindings of an import clause, including the default and namespace forms. */
function importedBindings(clause: ts.ImportClause | undefined): string[] {
  if (clause === undefined) {
    return [];
  }
  const names: string[] = [];
  if (clause.name !== undefined) {
    names.push(clause.name.text);
  }
  const bindings = clause.namedBindings;
  if (bindings !== undefined) {
    if (ts.isNamespaceImport(bindings)) {
      names.push(bindings.name.text);
    } else {
      for (const element of bindings.elements) {
        names.push((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

interface MutableMarkers {
  readonly propertyNames: Set<string>;
  readonly identifiers: Set<string>;
  readonly stringLiterals: Set<string>;
  readonly trueValuedProperties: Set<string>;
  readonly numericProperties: Map<string, number>;
}

function recordNumericProperty(
  markers: MutableMarkers,
  name: string,
  value: number,
): void {
  const existing = markers.numericProperties.get(name);
  if (existing === undefined || value > existing) {
    markers.numericProperties.set(name, value);
  }
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/**
 * Parse and scan one source file.
 *
 * Anchors are the evidence that a file reaches a model; markers are the
 * syntactic facts capability detection reads. Both are gathered in a single
 * traversal so a large repository is parsed once per file, not five times.
 *
 * @param input - The file and the detector config to apply.
 * @returns Anchors, capability flags and adapter signals for the file.
 */
export function scanSource(input: ScanSourceInput): FileScanResult {
  const { repo, path, source, config } = input;
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.Unknown,
  );

  const anchors: DetectedAnchor[] = [];
  const seen = new Set<string>();
  const markers: MutableMarkers = {
    propertyNames: new Set<string>(),
    identifiers: new Set<string>(),
    stringLiterals: new Set<string>(),
    trueValuedProperties: new Set<string>(),
    numericProperties: new Map<string, number>(),
  };

  const addAnchor = (
    node: ts.Node,
    kind: AnchorKind,
    detail: string,
    modelLiteral: string | null,
    alias: string | null,
  ): void => {
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    const key = `${line}|${kind}|${detail}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    anchors.push({ line, kind, detail, modelLiteral, alias });
  };

  const visitModuleSpecifier = (
    node: ts.Node,
    specifier: string,
    bindings: readonly string[],
  ): void => {
    if (isVendorSdkModule(specifier)) {
      addAnchor(node, "sdk_import", specifier, null, null);
      return;
    }
    if (specifier === LUMIC_MODULE) {
      const matched = bindings
        .filter((binding) => LUMIC_LLM_ENTRY_SYMBOLS.includes(binding))
        .sort();
      if (matched.length > 0) {
        addAnchor(
          node,
          "lumic_entry_import",
          `${LUMIC_MODULE}:${matched.join(",")}`,
          null,
          null,
        );
      }
      return;
    }
    const surface = bindings
      .filter((binding) => LLM_SURFACE_SYMBOLS.includes(binding))
      .sort();
    if (surface.length > 0) {
      addAnchor(
        node,
        "wrapper_import",
        `${specifier}:${surface.join(",")}`,
        null,
        null,
      );
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      visitModuleSpecifier(
        node,
        node.moduleSpecifier.text,
        importedBindings(node.importClause),
      );
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const names =
        clause !== undefined && ts.isNamedExports(clause)
          ? clause.elements.map((element) => (element.propertyName ?? element.name).text)
          : [];
      visitModuleSpecifier(node, node.moduleSpecifier.text, names);
    } else if (ts.isCallExpression(node)) {
      const callee = dottedName(node.expression);
      if (callee !== undefined && LLM_CALL_EXPRESSIONS.includes(callee)) {
        addAnchor(node, "llm_call", callee, null, null);
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        UNQUALIFIED_LLM_CALL_NAMES.includes(node.expression.name.text)
      ) {
        // A model call reached through an injected collaborator
        // (`this.gptAnalysis.callLLMWithTools(...)`) is the same call site as a
        // direct one. Matching the method name alone keeps DI-mediated calls in
        // the inventory, which is where most of the engine's calls live.
        addAnchor(node, "llm_call", node.expression.name.text, null, null);
      }
      if (
        callee === "require" &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0]) &&
        isVendorSdkModule(node.arguments[0].text)
      ) {
        addAnchor(node, "sdk_import", node.arguments[0].text, null, null);
      }
    } else if (ts.isNewExpression(node)) {
      const constructed = dottedName(node.expression);
      if (constructed !== undefined && SDK_CONSTRUCTORS.includes(constructed)) {
        addAnchor(node, "sdk_construction", constructed, null, null);
      }
    }

    if (ts.isIdentifier(node)) {
      markers.identifiers.add(node.text);
      if (config.providerKeyEnvVars.includes(node.text)) {
        addAnchor(node, "provider_key_env", node.text, null, null);
      }
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      markers.stringLiterals.add(node.text);
      if (isVendorModelLiteral(node.text)) {
        addAnchor(node, "model_literal", node.text, node.text, null);
      }
      if (config.aliasNames.includes(node.text)) {
        addAnchor(node, "alias_usage", node.text, null, node.text);
      }
      if (config.providerKeyEnvVars.includes(node.text)) {
        addAnchor(node, "provider_key_env", node.text, null, null);
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      markers.propertyNames.add(node.name.text);
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (name !== undefined) {
        markers.propertyNames.add(name);
        if (node.initializer.kind === ts.SyntaxKind.TrueKeyword) {
          markers.trueValuedProperties.add(name);
        } else if (ts.isNumericLiteral(node.initializer)) {
          recordNumericProperty(markers, name, Number(node.initializer.text));
        }
      }
    } else if (ts.isShorthandPropertyAssignment(node)) {
      markers.propertyNames.add(node.name.text);
    } else if (
      ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodSignature(node)
    ) {
      const name = propertyNameText(node.name);
      if (name !== undefined) {
        markers.propertyNames.add(name);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const frozenMarkers: SourceMarkers = markers;
  const features = detectFeatures(frozenMarkers);
  const adapterSignals = detectAdapterSignals(frozenMarkers, features);

  anchors.sort(
    (left, right) =>
      left.line - right.line ||
      left.kind.localeCompare(right.kind) ||
      left.detail.localeCompare(right.detail),
  );

  return { repo, path, anchors, features, adapterSignals };
}
