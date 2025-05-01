FROM mcr.microsoft.com/playwright:v1.52.0

# 1. Set working dir
WORKDIR /app

# 2. Copy in package.json and your script
COPY package.json qa-test.js ./

# 3. Install dependencies (npm install works without a lockfile)
RUN npm install

# 4. Make the script executable
RUN chmod +x qa-test.js

# 5. Default entrypoint
ENTRYPOINT ["node","qa-test.js"]
