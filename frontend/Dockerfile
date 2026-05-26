FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
CMD ["npm", "run", "dev"]
