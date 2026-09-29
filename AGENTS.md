# Asocialmedia guidelines

## Tooling

- Use `bun` as the package manager. This is a monorepo, so use workspaces to manage dependencies and shared code between packages.
- Install new packages with `bun add`. Never hand-edit `package.json`.
- Run `bun run check` for linting and formatting, and `bun run check-types` after making changes.
- Use context7 for the current docs of any library or package you touch, and for help when you hit an issue.

## Code

- Avoid `as any` at all costs. Infer types from the functions and values already in scope wherever you can.
- Use Tailwind for styling. Drop to custom CSS only when Tailwind genuinely cannot express it.
- Use descriptive variable and function names.
- Import shared code through its workspace name, for example `@asm/db`, never through a relative path like `../../../db`.
- Write tests. Add unit, integration, or end-to-end coverage as the change warrants, so bugs surface early.

## Comments

- Every comment must be a single-line `//` comment. Never use `/* */`, `/** */` (JSDoc), or any other block comment, in any file, for any reason.
- A multi-line explanation is several `//` lines stacked, not a block comment.
- The one exception is the `{/* ... */}` expression form required inside JSX children. That is a syntax requirement, not a style choice.

## Database

- This is Prisma 8, not Prisma 7. Read the [Prisma 8 migration architecture](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md) before changing the database layer.

## Git

- Never run git commands or commit until you are told to. Never modify or reset local changes.
- Commit with a descriptive message using a conventional type and an optional module scope, for example `feat[MESSAGES]: Add the anchored history window`.

| Type       | Use for                              |
| ---------- | ------------------------------------ |
| `feat`     | New feature                          |
| `fix`      | Bug fix                              |
| `docs`     | Documentation                        |
| `style`    | Formatting                           |
| `refactor` | Code change with no behaviour change |
| `test`     | Adding tests                         |
| `chore`    | Maintenance                          |
| `perf`     | Performance                          |
| `ci`       | Continuous integration               |
| `build`    | Build system                         |
| `revert`   | Revert changes                       |
| `wip`      | Work in progress                     |

## Message encryption

Messages use **server-recoverable encryption, not end-to-end encryption**. The backup key is derived from the identity row the server stores, so anyone who can read the database can read every message. This is a deliberate product decision, following Telegram's cloud semantics. Messages are encrypted in transit and at rest, and access is gated by session plus membership, which protects against everyone who is not the database operator. Do not re-label it as "end-to-end" in the UI or in docs, and do not harden it back into a scheme where recovery breaks for real users.

Anything that changes how message keys are derived, stored, wrapped, or recovered must keep all three of these true in the same PR:

1. **Recovery is automatic, and the stored row is the source.** The master key is derived with PBKDF2 from a random seed hash persisted with the identity, so a fresh device with no local storage and no user input must always recover. See `apps/web/src/lib/messages/crypto.ts` and the provider's `unlockIdentity`. Guarded by "the stored row alone derives the backup key" in `crypto.test.ts` and by the invariants in `recovery-invariants.test.ts`.
2. **Abandoned verifier rows still unlock where possible.** That is the short-lived scheme derived from a raw secret held on a single device. Keep the device-secret attempt in `unlockIdentity` so those rows are not stranded, since a reset clears them otherwise. Never re-introduce a user-facing secret or a passkey or PRF credential. Neither is needed once recovery is server-side.
3. **A lost key degrades, it never bricks.** When a row cannot be read, there must be a self-scoped reset path that loses only the resetting account's own history and leaves the peer's intact. See `DELETE /api/messages/identity` and the versioned wraps in `MessageConversationKey`. Bump the conversation-key `version` rather than overwriting a wrap, so the peer's older epochs stay readable.

## UI

Every raised surface in this app is the same construction: a hairline outer edge, a bright inner lip that catches light, on a surface one step above the page. These recipes live in `packages/ui/styles/globals.css` inside `@layer components`.

| Class | Use for |
| --- | --- |
| `panel-3d` | Floating surfaces: dialogs, dropdowns, popovers, tooltips |
| `surface-3d` | In-page raised surfaces: cards, list panels |
| `chip-3d` | Small status chips and tonal badges |
| `btn-3d` / `btn-3d-gray` | Primary and neutral buttons (already the `premium` Button variant) |
| `icon-btn-3d` | Round icon buttons |
| `premium-input` | Every text field (already the base of Input and Textarea) |
| `premium-checkbox` / `premium-radio` / `premium-switch` | The tactile form controls |
| `premium-slider-track` / `-range` / `-thumb` | Slider parts |

The shadcn primitives in `packages/ui/shadui` already apply these, so `<DialogContent>`, `<DropdownMenuContent>`, `<PopoverContent>`, `<TooltipContent>`, `<Card>`, `<Badge>`, `<Switch>`, `<Slider>`, `<Input>` and `<Textarea>` are 3D by default. Reach for the primitive rather than a hand-rolled div.

### The two rules that keep it working

1. **New recipes go in `@layer components`, never unlayered.** Utilities win against a layer, and that is deliberate: it lets a call site opt out with `bg-transparent`, `bg-black`, `border-0` or `shadow-none` instead of reaching for `!important`. A rule written unlayered, such as `.apple-panel` or the old `[role="dialog"] { box-shadow: none }` reset that used to strip the bevel off every dialog, outranks every utility and forces call sites to fight it.
2. **Dark mode uses a `.dark`-prefixed rule, never Tailwind's `dark:` variant.** This repo's `dark:` compiles to `@media (prefers-color-scheme: dark)`, which follows the OS rather than the app's theme class, so it fires even when the user has picked light. Write `.dark .thing { ... }`, or key off a themed custom property such as `hsl(var(--background))` that already follows the class.

### Adding a new primitive

Give the base class the recipe, and **remove any competing utility** from the same element (`bg-*`, `border`, `shadow-*`). A utility sitting next to the class beats it in the cascade, and the surface will silently do nothing. Radius is the common exception: the recipe sets one, so a call site that needs a different radius has to pass `rounded-*!`.

### Deprecated

`.apple-panel` in `apps/web/src/app/globals.css` is unlayered legacy and needs `!important` to apply. Prefer `panel-3d`, and drop `apple-panel` when you touch a call site that still passes it.
