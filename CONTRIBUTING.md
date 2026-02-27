# Contributing to Driver Shift Sheets

Thank you for your interest in contributing to Driver Shift Sheets! This document provides guidelines for contributing to the project.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/yourusername/driver-shift-sheets.git
   cd driver-shift-sheets
   ```
3. **Set up development environment**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env
   ```

## Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our coding standards

3. **Test your changes**:
   ```bash
   python app.py
   # Test in browser at http://localhost:5000
   ```

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "Add: Brief description of your changes"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request** on GitHub

## Coding Standards

### Python Code
- Follow PEP 8 style guidelines
- Use meaningful variable and function names
- Add docstrings for functions and classes
- Keep functions focused and small

### HTML/CSS
- Use semantic HTML elements
- Follow Bootstrap conventions where applicable
- Ensure responsive design works on mobile
- Test print styles for print templates

### Database Changes
- Always include database migrations
- Test with both empty and populated databases
- Consider backwards compatibility

## Types of Contributions

### Bug Reports
1. Check existing issues first
2. Use the bug report template
3. Include steps to reproduce
4. Provide environment details

### Feature Requests
1. Check if feature already exists
2. Describe the use case
3. Consider implementation complexity
4. Discuss in issues before implementing

### Code Contributions
- Bug fixes
- New features
- Performance improvements
- Documentation updates
- Test coverage improvements

## Pull Request Guidelines

### Before Submitting
- Ensure your code follows our standards
- Test on multiple browsers if UI changes
- Update documentation if needed
- Add or update tests if applicable

### Pull Request Description
- Clearly describe what the PR does
- Reference related issues
- Include screenshots for UI changes
- List any breaking changes

### Review Process
1. Automated checks must pass
2. Code review by maintainers
3. Testing by reviewers
4. Approval and merge

## Testing

### Manual Testing
- Test all affected functionality
- Check responsive design on mobile
- Verify print functionality works
- Test with different data scenarios

### Automated Testing (Future)
We plan to add automated testing. Contributions for test setup are welcome!

## Documentation

### Code Documentation
- Add docstrings for new functions
- Comment complex business logic
- Update type hints where applicable

### User Documentation
- Update README.md for new features
- Add screenshots for UI changes
- Update configuration examples

## Areas Needing Help

### High Priority
- Automated testing framework
- Data export/import functionality
- User authentication system
- Multi-company support

### Medium Priority
- Mobile app companion
- Email notifications
- Advanced reporting
- API documentation

### Low Priority
- Themes and customization
- Multi-language support
- Advanced search features

## Questions?

- **General questions**: Open a discussion on GitHub
- **Bug reports**: Create an issue
- **Feature ideas**: Start with a discussion
- **Security issues**: Email directly (see README)

## Code of Conduct

### Our Standards
- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Maintain professional communication

### Unacceptable Behavior
- Harassment or discrimination
- Trolling or inflammatory comments
- Personal attacks
- Spam or off-topic content

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes for significant contributions
- GitHub contributor graphs

Thank you for helping make Driver Shift Sheets better for everyone!

---

*This contributing guide is based on common open-source practices and will evolve with the project.*