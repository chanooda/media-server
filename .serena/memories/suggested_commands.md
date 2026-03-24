# Important Commands for Development

## Setup & Installation
```bash
pnpm install          # Install dependencies
```

## Development
```bash
pnpm run start        # Run application
pnpm run start:dev    # Run with watch mode
pnpm run start:debug  # Run with debugging
```

## Code Quality
```bash
pnpm run lint         # Lint and fix TypeScript files
pnpm run format       # Format code with Prettier
```

## Testing
```bash
pnpm run test         # Run unit tests
pnpm run test:watch   # Run tests in watch mode
pnpm run test:cov     # Run tests with coverage
pnpm run test:e2e     # Run e2e tests
```

## Build
```bash
pnpm run build        # Compile TypeScript
pnpm run start:prod   # Run production build
```

## Task Completion
After completing a task:
1. Run `pnpm run lint` to ensure code style compliance
2. Run `pnpm run format` to format code
3. Commit using git with descriptive messages
