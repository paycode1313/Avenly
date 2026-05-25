# Firebase Security Specification - MapVision PWA

## Data Invariants
- **User Profiles**: A user's profile metadata and favorites are private to the user.
- **Road Alerts**: Alerts are public for reading by all authenticated users. Creation requires authentication. Reputation/reporter IDs must match the authenticated user.
- **Social Posts**: Posts are public for reading by all authenticated users. Creation requires authentication. Only the post owner can modify the caption or delete the post. Likes are collaborative but restricted to unique UIDs.

## The Dirty Dozen Payloads (Rejection Targets)

1. **Identity Spoofing (Profile)**: Attempt to write to `/users/other-user-id` with your own UID.
2. **Identity Spoofing (Alert)**: Create a `RoadAlert` with `reporterId` set to a different user's UID.
3. **Identity Spoofing (Post)**: Create a `Post` with `userId` set to a different user's UID.
4. **Shadow Field (Alert)**: Create a `RoadAlert` with an undocumented `isVerified: true` field.
5. **State Shortcutting**: Update a `RoadAlert` severity to 'high' without being the original reporter.
6. **PII Blanket Leak**: Attempt to list all documents in `/users` as a non-admin.
7. **Resource Poisoning**: Send a 2MB string as the `description` for a `RoadAlert`.
8. **Orphaned Write**: Create a `Post` before the `UserProfile` exists (checked via `existsAfter`).
9. **Timestamp Manipulation**: Set a manual `createdAt` date in the past for a `Post`.
10. **Malicious Like**: Remove someone else's UID from the `likes` array in a `Post`.
11. **ID Poisoning**: Use a document ID containing malicious scripts or excessive length.
12. **Status Lock Break**: Attempt to modify a `RoadAlert` that has been marked as 'resolved' (system field).

## Test Runner (firestore.rules.test.ts)
Verification logic will ensure all above payloads return PERMISSION_DENIED.
