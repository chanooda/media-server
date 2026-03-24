# Media Server Project Overview

## Purpose
A NestJS-based media server application for handling file uploads, storage management, and image processing/conversion.

## Tech Stack
- **Framework**: NestJS 11
- **Language**: TypeScript 5.7
- **Runtime**: Node.js (ES2023 target)
- **Package Manager**: pnpm
- **Storage**: AWS S3 (via @aws-sdk/client-s3)
- **Image Processing**: Sharp (image manipulation library)
- **Testing**: Jest with ts-jest
- **Code Quality**: ESLint with TypeScript support, Prettier
- **Configuration**: @nestjs/config (class-validator, class-transformer)

## Code Style & Conventions
- **Formatting**: Prettier with singleQuote: true, trailingComma: all
- **Linting**: ESLint configured with TypeScript plugin
- **TypeScript**: Strict mode enabled with strictNullChecks, decorators enabled
- **Module System**: ES2023 with Node.js module resolution
- **Naming**: Standard NestJS conventions (services, modules, controllers, interfaces)

## Key Dependencies
- @nestjs/common, @nestjs/core, @nestjs/platform-express
- @nestjs/schedule for scheduled tasks
- @aws-sdk for S3 integration
- sharp for image processing
- uuid for unique identifiers
- class-validator and class-transformer for DTO validation

## Project Structure
- `src/` - Main application code
  - `src/config/` - Configuration files
  - `src/main.ts` - Entry point
  - `src/app.module.ts` - Root module
  - `src/app.controller.ts` - Main controller
  - `src/app.service.ts` - Main service
- `test/` - Test files (e2e tests)
- `dist/` - Compiled output
