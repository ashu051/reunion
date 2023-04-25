FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

# Set environment variables
ENV PORT 3000
ENV DBConnLink postgres://ashu:CvGEnT4q274j07SkrjYywNq37wu7113J@dpg-ch3b0atgk4qarqljqrsg-a.oregon-postgres.render.com/reunion_6mvz?ssl=true

# Expose port
EXPOSE 3000

# Run the application
CMD ["npm", "start"]
