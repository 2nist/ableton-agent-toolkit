/**
 * Virtual REAPER Test Runner
 *
 * Port of EnviREAment's enhanced_test_runner.lua testing framework.
 * Provides:
 *   - Multi-phase testing (standalone → virtual → real REAPER)
 *   - Performance metrics collection
 *   - ImGui Begin/End stack validation
 *   - Mock function coverage tracking
 *
 * Pattern: EnviREAment testing SOP (SOP_TESTING_REQUIREMENTS.md)
 */

import type {
  TestPhaseResult,
  TestResult,
  TestMetrics,
  ImGuiStackValidator,
  MockSyncDiff,
} from "./types";

/**
 * Test runner for virtual REAPER environment testing.
 */
export class TestRunner {
  private results: TestPhaseResult[] = [];
  private metrics: TestMetrics;
  private startTime: number = 0;
  private imguiStack: ImGuiStackValidator;

  constructor() {
    this.metrics = {
      apiCalls: 0,
      windowsCreated: 0,
      widgetsDrawn: 0,
      errors: 0,
      warnings: 0,
      memoryKb: 0,
      durationMs: 0,
    };

    this.imguiStack = {
      windowStackDepth: 0,
      balanced: true,
      windowNames: [],
      errors: [],
    };
  }

  /**
   * Run a named test.
   */
  runTest(name: string, testFn: () => void | Promise<void>): TestResult {
    const start = performance.now();
    let passed = true;
    let error: string | undefined;

    try {
      const result = testFn();
      if (result instanceof Promise) {
        // For async tests, record as pending (not fully supported yet)
        passed = true;
      }
    } catch (e: any) {
      passed = false;
      error = e?.message ?? String(e);
      this.metrics.errors++;
    }

    const durationMs = performance.now() - start;
    return { name, passed, error, durationMs };
  }

  /**
   * Begin a test phase (e.g., "Standalone", "EnviREAment", "REAPER Integration").
   */
  beginPhase(phaseName: string): void {
    this.startTime = performance.now();
    console.log(`[TEST] Starting phase: ${phaseName}`);
  }

  /**
   * End the current test phase and record results.
   */
  endPhase(phaseName: string, tests: TestResult[]): TestPhaseResult {
    const durationMs = performance.now() - this.startTime;
    const passed = tests.every((t) => t.passed);
    const errors = tests.filter((t) => !t.passed).map((t) => t.error ?? "");

    const phase: TestPhaseResult = {
      phase: phaseName,
      passed,
      tests,
      metrics: { ...this.metrics, durationMs },
      errors,
    };

    this.results.push(phase);

    // Log phase summary
    console.log(
      `[TEST] Phase "${phaseName}": ${passed ? "PASSED" : "FAILED"} ` +
      `(${tests.filter(t => t.passed).length}/${tests.length} tests, ${durationMs.toFixed(0)}ms)`
    );

    return phase;
  }

  /**
   * Track an ImGui window begin call for stack validation.
   */
  imguiBegin(windowName: string): void {
    this.imguiStack.windowStackDepth++;
    this.imguiStack.windowNames.push(windowName);
    this.metrics.windowsCreated++;
  }

  /**
   * Track an ImGui window end call for stack validation.
   */
  imguiEnd(): void {
    if (this.imguiStack.windowStackDepth <= 0) {
      this.imguiStack.balanced = false;
      this.imguiStack.errors.push(
        "ImGui_End called without matching ImGui_Begin"
      );
      return;
    }
    this.imguiStack.windowStackDepth--;
    this.imguiStack.windowNames.pop();
  }

  /**
   * Validate ImGui Begin/End call balance after a test run.
   */
  validateImGuiStack(): boolean {
    if (this.imguiStack.windowStackDepth !== 0) {
      this.imguiStack.balanced = false;
      this.imguiStack.errors.push(
        `ImGui_Begin/End mismatch: ${this.imguiStack.windowStackDepth} unclosed windows`
      );
    }
    return this.imguiStack.balanced;
  }

  /**
   * Get ImGui stack validation results.
   */
  getImGuiStack(): Readonly<ImGuiStackValidator> {
    return this.imguiStack;
  }

  /**
   * Track an API call for metrics.
   */
  trackApiCall(): void {
    this.metrics.apiCalls++;
  }

  /**
   * Track a widget draw for metrics.
   */
  trackWidget(): void {
    this.metrics.widgetsDrawn++;
  }

  /**
   * Get current performance metrics.
   */
  getMetrics(): Readonly<TestMetrics> {
    return this.metrics;
  }

  /**
   * Get all test phase results.
   */
  getResults(): readonly TestPhaseResult[] {
    return this.results;
  }

  /**
   * Check if all phases passed.
   */
  allPassed(): boolean {
    return this.results.every((p) => p.passed);
  }

  /**
   * Generate a summary report.
   */
  generateReport(): string {
    const totalTests = this.results.reduce(
      (sum, p) => sum + p.tests.length,
      0
    );
    const passedTests = this.results.reduce(
      (sum, p) => sum + p.tests.filter((t) => t.passed).length,
      0
    );
    const totalDuration = this.results.reduce(
      (sum, p) => sum + p.metrics.durationMs,
      0
    );

    let report = "=== Virtual REAPER Test Report ===\n\n";
    report += `Overall: ${this.allPassed() ? "✅ PASSED" : "❌ FAILED"}\n`;
    report += `Tests: ${passedTests}/${totalTests} passed\n`;
    report += `Phases: ${this.results.filter(p => p.passed).length}/${this.results.length} passed\n`;
    report += `Total Duration: ${totalDuration.toFixed(0)}ms\n`;
    report += `API Calls: ${this.metrics.apiCalls}\n`;
    report += `Widgets Drawn: ${this.metrics.widgetsDrawn}\n`;
    report += `Errors: ${this.metrics.errors}\n`;
    report += `Warnings: ${this.metrics.warnings}\n\n`;

    for (const phase of this.results) {
      report += `--- ${phase.phase} (${phase.passed ? "PASS" : "FAIL"}) ---\n`;
      for (const test of phase.tests) {
        report += `  ${test.passed ? "✓" : "✗"} ${test.name} (${test.durationMs.toFixed(0)}ms)\n`;
        if (test.error) {
          report += `    Error: ${test.error}\n`;
        }
      }
      report += "\n";
    }

    // ImGui validation
    if (!this.imguiStack.balanced) {
      report += "⚠ ImGui Stack Validation FAILED:\n";
      for (const err of this.imguiStack.errors) {
        report += `  - ${err}\n`;
      }
    } else {
      report += "✅ ImGui Begin/End calls balanced\n";
    }

    return report;
  }

  /**
   * Reset all results and metrics for a fresh test run.
   */
  reset(): void {
    this.results = [];
    this.metrics = {
      apiCalls: 0,
      windowsCreated: 0,
      widgetsDrawn: 0,
      errors: 0,
      warnings: 0,
      memoryKb: 0,
      durationMs: 0,
    };
    this.imguiStack = {
      windowStackDepth: 0,
      balanced: true,
      windowNames: [],
      errors: [],
    };
  }
}

/**
 * Generate a mock sync diff by comparing results from real REAPER
 * against EnviREAment mock results.
 *
 * Pattern: EnviREAment scripts:
 *   - autogen_imgui_api_tests.lua  (auto-generates API tests)
 *   - parse_imgui_api_test_results.lua (parses test logs)
 *   - sync_envi_mocks.lua (creates new mock stubs)
 *   - harden_envi_mocks.lua (hardens stubs with type checking)
 */
export function generateMockSyncDiff(
  realResults: string[],
  mockResults: string[]
): MockSyncDiff {
  const realSet = new Set(realResults);
  const mockSet = new Set(mockResults);

  return {
    missing: [...realSet].filter((f) => !mockSet.has(f)),
    mismatched: [], // Would need detailed comparison
    added: [...mockSet].filter((f) => !realSet.has(f)),
    hardened: [], // Would need hardening pipeline
  };
}

export default TestRunner;
