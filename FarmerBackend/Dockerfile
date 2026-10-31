# Use the official Node.js image as the base
FROM node:16

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
COPY package*.json ./
RUN npm install

# Copy all project files into the container
COPY . .

# Expose the port that your server will run on
EXPOSE 5002

# Start the server
CMD ["node", "serverfarm.js"]
