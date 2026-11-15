# Evidence packages and integrity boundary

The GitHub update is an incremental source/documentation bundle. It is not a wholesale repository replacement and not the complete scientific evidence archive.

## Original input preserved

- Original repository archive: `Falmex-main.zip`
- SHA-256: `5aa716b9088a46f87f8df9d1d796a50aa0daf2d55e5d8b7252d94b7cd6bea5bb`
- The uploaded archive was not edited. The update contains only files identified as added or changed, plus new BASS-II and handoff files.

## Complete BASS-II evidence

- File: `FlamexSI-Vision-v6-full.zip`
- Size: 482,831,977 bytes
- SHA-256: `cd957358eee42f5c0023c9b10114c65737ac2bb26a36b9127e48cdfbcb56bce3`
- Verification: ZIP CRC passed; fresh-extraction delivery verifier passed 55/55 checks; repeated v6 confirmation inference was pixel-identical.
- Required for full training/raw-video evidence and the original 55-check verifier. The lightweight GitHub tree is not a substitute.

## Blinded review and adjudication

- Two-reviewer distribution package: `FlamexSI-independent-review-v6.zip`
- SHA-256: `df2757c9ce8b4cf715fa468a35a588f5eed54d35633a74e0e4457c4762ad7a72`
- Third-adjudicator package: `FlamexSI-third-adjudicator-v6.zip`
- SHA-256: `12eaad39ea6b8984cadf70aa62bff46057c5ddc045530b49e48e590fe68c6aab`
- The team supplied a qualitative review decision. Dual-reference reporting is complete. The separate A and B masks are retained; no third pixel reference was produced.

## Competition draft

- File: `FlamexSI-competition-prefinal-v6.zip`
- SHA-256: `114db84b3c5c0e575f5c8d3f1ce482b4e8c036afef4e3c794a5ecf19cdd27224`
- Status: dual-reference analysis complete, pending team and portal fields. This package is a draft, not evidence of submission, expert approval, or operational readiness.

## Security and publication

No signed NASA S3 URL, temporary AWS parameter, API key, or other secret belongs in Git history. No website deployment or public release has been performed by this handoff. Attach large evidence archives through a storage/release method permitted by the competition only after the team decides to publish them.


## Dual-reference decision

The team adopted separate A and B scores for this release. B covers more pixels in all 24 frames. Six frames contain A-only pixels. In the reviewed example, the shared region covers the brighter emission and B extends into the halo and isolated luminous spots. Their physical origin is unresolved. No third pixel mask was drawn.
