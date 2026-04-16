// Judge0 CE public API is used for code execution.
const JUDGE0_API = (import.meta.env?.VITE_JUDGE0_API_URL || "https://ce.judge0.com").replace(/\/$/, "");

const LANGUAGE_CONFIG = {
  javascript: { languageId: 63 },
  python: { languageId: 71 },
  java: { languageId: 62 },
};

const TEST_MARKER_PREFIX = "__HD_TEST__";

function normalizeSourceForLanguage(language, source) {
  if (language !== "java") return source;

  if (/public\s+class\s+Main\b/.test(source)) {
    return source;
  }

  if (/public\s+class\s+Solution\b/.test(source)) {
    return source.replace(/public\s+class\s+Solution\b/, "public class Main");
  }

  if (/class\s+Solution\b/.test(source)) {
    return source.replace(/class\s+Solution\b/, "class Main");
  }

  return source;
}

function escapeForTemplateLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function injectJavaScriptStructuredTests(sourceCode) {
  const lines = sourceCode.split("\n");
  let testIndex = 0;

  const transformedLines = lines.map((line) => {
    const match = line.match(/^\s*console\.log\((.*)\)\s*;\s*\/\/\s*Expected:\s*(.*)\s*$/);
    if (!match) return line;

    testIndex += 1;
    const expression = match[1].trim();
    const expected = escapeForTemplateLiteral(match[2].trim());

    return [
      "(() => {",
      `  const __hdActual = (${expression});`,
      "  const __hdActualStr = typeof __hdActual === \"string\" ? __hdActual : JSON.stringify(__hdActual);",
      `  const __hdExpected = \`${expected}\`;`,
      "  const __hdNormalize = (value) => String(value == null ? \"\" : value).trim().replace(/\\s+/g, \"\").toLowerCase();",
      "  const __hdPass = __hdNormalize(__hdActualStr) === __hdNormalize(__hdExpected);",
      `  console.log(\"${TEST_MARKER_PREFIX}\" + JSON.stringify({ index: ${testIndex}, pass: __hdPass, expected: __hdExpected, actual: __hdActualStr }));`,
      "})();",
    ].join("\n");
  });

  if (testIndex === 0) {
    return sourceCode;
  }

  return transformedLines.join("\n");
}

function parseStructuredTestOutput(output) {
  const results = [];
  const passthroughLines = [];

  for (const line of String(output || "").split("\n")) {
    if (line.startsWith(TEST_MARKER_PREFIX)) {
      const rawPayload = line.slice(TEST_MARKER_PREFIX.length);
      try {
        const parsed = JSON.parse(rawPayload);
        results.push(parsed);
      } catch {
        passthroughLines.push(line);
      }
      continue;
    }

    passthroughLines.push(line);
  }

  if (results.length === 0) {
    return {
      results,
      formattedOutput: output,
      summary: null,
    };
  }

  const formattedResults = results.map((result) => {
    const status = result.pass ? "PASS" : "FAIL";
    return `Test ${result.index}: ${status} | expected: ${result.expected} | actual: ${result.actual}`;
  });

  const passed = results.filter((result) => result.pass).length;
  const summaryLine = `Summary: ${passed}/${results.length} tests passed`;
  const cleanPassthrough = passthroughLines.filter((line) => line.trim().length > 0);

  const formattedOutput = [...cleanPassthrough, ...formattedResults, summaryLine].join("\n");

  return {
    results,
    formattedOutput,
    summary: {
      total: results.length,
      passed,
      allPassed: passed === results.length,
    },
  };
}

function isLikelyMissingReturnCase(language, sourceCode, stdout) {
  if (language !== "javascript" || !stdout) return false;

  const hasUndefinedLine = stdout
    .split("\n")
    .some((line) => line.trim() === "undefined");

  if (!hasUndefinedLine) return false;

  // Heuristic: most DSA templates call console.log(myFn(...)).
  // If function body never returns, JS prints undefined for each call.
  return /console\.log\s*\(/.test(sourceCode);
}

/**
 * @param {string} language - programming language
 * @param {string} code - source code to executed
 * @returns {Promise<{success:boolean, output?:string, error?: string}>}
 */
export async function executeCode(language, code) {
  try {
    const languageConfig = LANGUAGE_CONFIG[language];

    if (!languageConfig) {
      return {
        success: false,
        error: `Unsupported language: ${language}`,
      };
    }

    const sourceCode =
      language === "javascript"
        ? injectJavaScriptStructuredTests(code)
        : code;

    const response = await fetch(`${JUDGE0_API}/submissions?base64_encoded=false&wait=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language_id: languageConfig.languageId,
        source_code: normalizeSourceForLanguage(language, sourceCode),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        error: data?.message || `HTTP error! status: ${response.status}`,
      };
    }

    const output = data.stdout || "";
    const stderr = data.stderr || "";
    const compileOutput = data.compile_output || "";
    const apiMessage = data.message || "";

    const structured = parseStructuredTestOutput(output);

    if (stderr || compileOutput || apiMessage || (data.status?.id && data.status.id > 3)) {
      const errorMessage = stderr || compileOutput || apiMessage || data.status?.description || "Execution failed";

      return {
        success: false,
        output: structured.formattedOutput,
        error: errorMessage,
      };
    }

    if (isLikelyMissingReturnCase(language, code, output)) {
      return {
        success: false,
        output: structured.formattedOutput,
        error:
          "Your JavaScript function is returning undefined for at least one test. Add an explicit return value (for example true/false) instead of only logging inside the function.",
      };
    }

    return {
      success: true,
      output: structured.formattedOutput || "No output",
      testSummary: structured.summary,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to execute code: ${error.message}`,
    };
  }
}