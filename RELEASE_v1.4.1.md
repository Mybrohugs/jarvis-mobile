# v1.4.1 — clear ChatGPT status and recovery (DEV)

The paired PC now distinguishes network failures, usage limits, sign-in requirements, restricted access and service problems. The phone preserves safe error metadata and displays separate status labels. No automatic resubmission of a chat turn was added. Service-worker activation removes only this mobile app's old caches.

Requires matching PC DEV v1.4.1. All 28 Node tests passed; a 390x844 browser test verified failure labels and recovery through a real test HTTP gateway with mocked inference. Actual concurrent desktop/phone requests also passed. Existing pairing and TV controls are preserved. Production/Pages and the original v1.4 drafts remain unchanged.
