# Firebase SMS delivery investigation — 2026-09-21

## Confirmed incident

- Project: `qareeb-dev` (`110542585455`), Identity Platform.
- Site: https://qareeb-dev.web.app/signin.
- Reporting device: iPhone, Safari. The same number has not been tested on another device.
- Reporting carrier: Partner (Israel).
- User confirmed the complete reference `sending/error-code:-39` after deploying the numeric error-code diagnostic correction.
- The preceding 24-hour Monitoring snapshot contained 3 successful SendVerificationCode calls (HTTP 200) and 6 failures (HTTP 503 / gRPC 14). These are aggregate project metrics, not a request-level trace of the reporting user.
- Billing, phone sign-in and Israel SMS allowlisting were enabled. The authorized Hosting domains were present.
- Request logging was not enabled; no individual Identity Toolkit request logs were available. Do not collect phone numbers, tokens or OTPs in frontend logs.

Google support associates this error with carrier/region reliability restrictions:
https://groups.google.com/g/firebase-talk/c/_6QwT2dubu8

This supports a provider delivery restriction as the likely cause. It does not establish that all Partner numbers are blocked. A Firebase support review is needed to determine the exact provider restriction.

## SMS Defense preparation

Google's supported SMS Defense integration is a possible remediation, not a verified resolution for this number:
https://docs.cloud.google.com/identity-platform/docs/recaptcha-tfp

Completed via authenticated Google Cloud APIs:

- Enabled `recaptchaenterprise.googleapis.com` and verified `ENABLED`.
- Generated the Identity Toolkit service identity.
- Granted only `roles/identitytoolkit.serviceAgent` to `service-110542585455@gcp-sa-identitytoolkit.iam.gserviceaccount.com`, preserving the existing IAM policy and its etag.
- Confirmed no existing reCAPTCHA keys. Firebase Auth's `recaptchaConfig` has not been changed and SMS region allowlisting remains Israel only.

The project-level SMS Defense activation is documented as a Cloud Console step. The initial browser was not signed into Google Cloud. The user subsequently signed in, but followed Security Command Center's Settings link and encountered its organization requirement. No organization was created. Navigating to https://console.cloud.google.com/security/recaptcha/settings?project=qareeb-dev opened the separate Fraud Defense settings successfully. SMS defense was enabled and saved, then reopened to verify the Enable switch was checked. This also enables account defender. Google bills reCAPTCHA assessments according to usage; SMS Defense requires an extra assessment. Pricing: https://cloud.google.com/security/products/recaptcha#pricing.

After enabling the project-level toggle, the following authenticated Identity Toolkit Admin API PATCH was applied to `https://identitytoolkit.googleapis.com/admin/v2/projects/qareeb-dev/config?updateMask=recaptchaConfig.phoneEnforcementState,recaptchaConfig.useSmsTollFraudProtection,recaptchaConfig.tollFraudManagedRules`. The prior configuration was saved locally to `/tmp/qareeb-auth-before-sms-defense.json` with mode 0600:

```json
{
  "recaptchaConfig": {
    "phoneEnforcementState": "AUDIT",
    "useSmsTollFraudProtection": true,
    "tollFraudManagedRules": [{ "action": "BLOCK", "startScore": 0.8 }]
  }
}
```

The threshold is Google's recommended initial value. Keep AUDIT limited to setup verification; it permits existing reCAPTCHA v2 fallback. Verify provisioning of a WEB key, domain restrictions, browser SDK compatibility, and actual assessment metrics before switching `phoneEnforcementState` to `ENFORCE`. Do not claim resolution until the affected user's SMS arrives and verifies successfully. If verification cannot be completed or introduces regressions, restore `phoneEnforcementState: OFF` and `useSmsTollFraudProtection: false` rather than leaving an unverified rollout active. The app uses Firebase JS 12.19.0, which supports the integration; Safari uses the Web setup, not native iOS configuration.

Google provisioned WEB, IOS and ANDROID integration keys. Firebase authorized domains and the Israel-only region policy remain unchanged. The automatically managed WEB key allows all domains; Firebase's authorized-domain allowlist remains configured. A live iPhone WebKit check loaded Google's actual Enterprise script on the deployed sign-in page and obtained a token. A real reCAPTCHA assessment verified `valid: true`, hostname `qareeb-dev.web.app`, action `sendVerificationCode`, and returned risk analysis. This assessment did not include a phone number or send an SMS, and does not prove carrier delivery.

A second live assessment used a fresh genuine token and the reserved fictional number `+16505550100`, returning a valid token and `phoneFraudAssessment.smsTollFraudVerdict.risk: 0.9`. No SMS was sent, and this is not a score for the reporting user's number. This verifies that the project-level SMS Defense feature returns fraud assessments. The targeted SDK tests had already verified token submission, AUDIT fallback and ENFORCE rejection behavior.

After these setup checks, Auth was switched from AUDIT to ENFORCE, preserving the 0.8 BLOCK threshold, SMS Defense flag and Israel-only region allowlist. Admin API readback confirmed the new state. The initial audit period lasted several minutes; no real-user Auth assessment metrics were available during it. Actual customer scoring, Partner SMS delivery and successful OTP verification remain unverified. The reporting user was asked to make one live attempt and was informed of the switch to enforcement. No Hosting build is needed for this server-side configuration change.

## Application changes and validation

Error 39 now displays a specific delivery-unavailable message in English, Hebrew and Arabic, while preserving the diagnostic reference. The production build and E2E typecheck passed. Ten targeted checks passed across iPhone WebKit and mobile Chromium: numeric error rendering; enterprise token submission in AUDIT and ENFORCE; fallback after a rejected assessment in AUDIT; and rejection without fallback in ENFORCE. External CAPTCHA and authentication responses are simulated, so these checks establish SDK integration behavior, not successful real delivery or a real fraud assessment.

## Support request draft (not submitted)

Subject: Phone Authentication error 39 / HTTP 503 for Partner Israel in qareeb-dev

Our production web phone sign-in at https://qareeb-dev.web.app/signin fails after reCAPTCHA on iPhone Safari for a user on Partner Israel. The confirmed Firebase JS 12.19.0 code is `auth/error-code:-39`. Project `qareeb-dev` (`110542585455`) has billing enabled, Phone sign-in enabled, authorized Hosting domains, and an explicit Israel-only SMS region allowlist. Monitoring shows both HTTP 200 and HTTP 503 responses for SendVerificationCode. We have not established whether the same number fails on other devices, or whether other Partner numbers are affected.

Please identify the backend delivery restriction for these requests and advise whether a provider-side change is required. SMS Defense's project-level toggle is enabled, and its Auth integration is in ENFORCE mode with a 0.8 threshold. Genuine browser tokens and SMS fraud assessments have been verified, but successful delivery to the affected Partner number is still unconfirmed. We can provide the affected number privately through the support case if needed, with the user's consent.
