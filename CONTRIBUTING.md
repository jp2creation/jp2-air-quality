# Contributing to JP2 Air Quality Card

Thank you for your interest in contributing to **JP2 Air Quality Card**.

This project is a custom Home Assistant Lovelace card designed to display indoor air quality and comfort data in a clear and modern dashboard.

Contributions are welcome, whether you are fixing bugs, improving the visual editor, enhancing documentation, or proposing new features.

## Before You Start

Before opening a pull request, please:

- Check existing **Issues** to avoid duplicates
- Open an issue first for large changes or new features
- Keep contributions focused on one topic at a time
- Make sure your changes fit the purpose and style of the project

## Reporting Bugs

If you found a bug, please open an issue and include as much detail as possible:

- Home Assistant version
- Card version
- Your YAML configuration (remove any sensitive information)
- Browser and device used
- Console errors or logs (F12)
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Screenshots, if useful

A complete bug report makes it much easier to diagnose and fix problems quickly.

## Suggesting Features

Feature requests are welcome.

When suggesting an improvement, please include:

- The problem you are trying to solve
- Why the current behavior is limiting
- Your proposed solution
- Optional examples, mockups, or screenshots

Clear and practical feature requests are easier to review and prioritize.

## Development Workflow

Recommended workflow:

1. Fork the repository
2. Create a new branch:
   - `feature/your-feature-name`
   - `fix/your-bugfix-name`
3. Install dependencies with `npm install`
4. Make your changes in the source files
5. Run the build before submitting:
   - `npm run build` for a production build
   - `npm run watch` while developing
6. Test your changes in Home Assistant
7. Update documentation or examples if needed
8. Open a pull request

## Pull Request Guidelines

When submitting a pull request:

- Keep it small and focused
- Write a clear title and description
- Explain what changed and why
- Link the related issue if applicable
- Include screenshots or GIFs for UI changes
- Avoid unrelated formatting changes
- Keep commit history clean and readable

If your change affects behavior, configuration, or the visual editor, please update the README or examples as well.

## Code Style

Please try to keep the code:

- Clear and readable
- Consistent with the existing structure
- Backward-compatible when possible
- Free of unrelated refactoring in the same pull request

If a change affects the distributed file, keep the output filename exactly **`jp2-air-quality.js`**.

## Testing

Before submitting, please verify that:

- The card loads correctly in Home Assistant
- No console errors are introduced
- Existing configuration still works
- New options behave correctly in both YAML and the visual editor
- UI changes display properly on desktop and mobile when relevant

## Documentation

Documentation improvements are always appreciated.

Please update documentation when you:

- Add or rename options
- Change configuration behavior
- Modify the visual editor
- Introduce new sensors, labels, or display modes

## Security and Privacy

Please do not include:

- Access tokens
- Private URLs
- Personal configuration data
- Screenshots containing sensitive information

If you discover a security-related issue, report it privately instead of posting it publicly in an issue.

## Questions

If you are unsure whether something should be changed, feel free to open an issue first and describe your idea before starting work.

## Thank You

Your help improves the project for everyone using JP2 Air Quality Card. Thank you for contributing.
