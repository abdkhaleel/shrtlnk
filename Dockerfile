# 1. Use an official Node.js runtime as a parent image
FROM node:16-alpine

# 2. Set the working directory in the container
WORKDIR /app

# 3. Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# 4. Install production dependencies
RUN npm install --only=production

# 5. Copy the rest of the application code
COPY . .

# 6. Build the TypeScript code into JavaScript
RUN npm run build

# 7. Expose the port the app runs on
EXPOSE 3000

# 8. Define the command to run the app
CMD [ "npm", "start" ]