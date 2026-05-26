FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN addgroup -S app && adduser -S app -G app
USER app
CMD ["npm", "run", "start:dev"]
