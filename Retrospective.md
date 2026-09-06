# Retrospective

## 2026-09-06: unverified probe transformations

During B4c3 review, a temporary test copy was read while the implementer was editing the source.
The review script applied string replacements without checking that they matched. The resulting
tests still exercised manual toast dismissal, yet their passing result was incorrectly reported as
timer-expiry evidence. This delayed diagnosis of the actual Testing Library fake-timer interaction.

The earlier claim was withdrawn. A fresh copy asserted the expected timer declarations and boundary
advances before execution. After replacing asynchronous queries under a stopped fake clock with
synchronous queries after `act`, all nine cases passed, including URL revocation and both toast
expiry boundaries. No production behavior was changed to satisfy the test.

Review probes should use a fixed commit where possible. When reading an actively edited file,
validate its expected structure and every transformation count, inspect the resulting assertions,
and run the relevant full test group before reporting evidence. A matching test name or successful
exit alone does not establish that the intended regression was exercised.
