# Asocialmedia guidelines:

- use bun for the package manager
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
- don't use `/* */` comments, instead use `//` for single-line and multi-line comments
- use git for version control, and commit your changes with descriptive commit messages in the format of `feat`: New feature, `fix`: Bug fix, `docs`: Documentation, `style`: Formatting, `refactor`: Code change, `test`: Adding tests, `chore`: Maintenance, `perf`: Performance, `ci`: Continuous integration, `build`: Build system, `revert`: Revert changes, `wip`: Work in progress example: `feat[MODULE]: Add new module`