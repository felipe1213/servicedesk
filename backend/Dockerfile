FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev"]
