FROM node:25-alpine

# Install pnpm globally
RUN npm install -g pnpm@11.0.8

# Set working directory
WORKDIR /workspace

# Use node user
USER node
