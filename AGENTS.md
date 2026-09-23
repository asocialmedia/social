# Asocialmedia guidelines:

- use bun for the package manager
- never commit or run git commands until told, never modify or reset the local changes
- this is a monorepo, so use workspaces to manage dependencies and shared code between packages
- when installing new packages, use bun add instead of manually editing the package.json file
- avoid as any at all costs, try to infer types from functions as much as possible
- use tailwindcss for styling whenever possible, only resort to custom css if needed
- run bun run check to check for linting & formatting errors, and bun run check-types to check for errors after making changes
- use context7 to get the latest docs about the library or package you are using, and to get help with any issues you encounter
- write tests for your code to ensure it works as expected and to catch any potential bugs early on
- write unit, integration, and end-to-end tests as appropriate for the functionality you are implementing
- use descriptive variable and function names to improve code readability and maintainability
- import shared modules using workspace names: `@asm/shared` instead of relative paths like `../../../shared`
- every comment must be single-line `//` comments only. NEVER use `/* */`, `/** */` (JSDoc), or any block comment, anywhere, in any file, for any reason. A multi-line explanation is just several `//` lines stacked. The only exception is the `{/* ... */}` expression form required inside JSX children, which is a syntax requirement, not a comment style choice.
- use git for version control, and commit your changes with descriptive commit messages in the format of `feat`: New feature, `fix`: Bug fix, `docs`: Documentation, `style`: Formatting, `refactor`: Code change, `test`: Adding tests, `chore`: Maintenance, `perf`: Performance, `ci`: Continuous integration, `build`: Build system, `revert`: Revert changes, `wip`: Work in progress example: `feat[MODULE]: Add new module`

# UI:

Every raised surface in this app is the same construction: a hairline outer edge, a bright inner lip that catches light, on a surface one step above the page. These recipes live in `packages/ui/styles/globals.css`, inside `@layer components`:

| class | use for |
| --- | --- |
| `panel-3d` | floating surfaces: dialogs, dropdowns, popovers, tooltips |
| `surface-3d` | in-page raised surfaces: cards, list panels |
| `chip-3d` | small status chips, tonal badges |
| `btn-3d` / `btn-3d-gray` | primary / neutral buttons (already the `premium` Button variant) |
| `icon-btn-3d` | round icon buttons |
| `premium-input` | every text field (already the base of Input and Textarea) |
| `premium-checkbox` / `premium-radio` / `premium-switch` | the tactile form controls |
| `premium-slider-track` / `-range` / `-thumb` | slider parts |

The shadcn primitives in `packages/ui/shadui` already apply these, so `<DialogContent>`, `<DropdownMenuContent>`, `<PopoverContent>`, `<TooltipContent>`, `<Card>`, `<Badge>`, `<Switch>`, `<Slider>`, `<Input>` and `<Textarea>` are 3D by default. Reach for the primitive, not a hand-rolled div.

## The two rules that keep it working

1. **New recipes go in `@layer components`, never unlayered.** Utilities win against a layer. That is deliberate: it lets a call site opt out with `bg-transparent`, `bg-black`, `border-0` or `shadow-none` instead of `!important`. A rule written unlayered (like `.apple-panel`, or the old `[role="dialog"] { box-shadow: none }` reset that used to strip the bevel off every dialog) outranks every utility and forces call sites to fight it.

2. **Dark mode uses a `.dark`-prefixed rule, never Tailwind's `dark:` variant.** This repo's `dark:` compiles to `@media (prefers-color-scheme: dark)`, which follows the OS rather than the app's theme class, so it fires even when the user has picked light. Write `.dark .thing { … }`, or key off a themed custom property (`hsl(var(--background))`) that already follows the class.

## Adding a new primitive

Give the base class the recipe, and **remove any competing utility** from the same element (`bg-*`, `border`, `shadow-*`). A utility sitting next to the class will beat it in the cascade and the surface will silently do nothing. Radius is the common exception: the recipe sets one, so a call site that needs a different radius has to pass `rounded-*!`.

## Deprecated

`.apple-panel` in `apps/web/src/app/globals.css` is unlayered legacy and needs `!important` to apply. Prefer `panel-3d`; when touching a call site that still passes `apple-panel`, drop it.
