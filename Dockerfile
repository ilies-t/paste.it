FROM node:20.18.0-alpine
WORKDIR /app
COPY package*.json /app
RUN npm ci
COPY . /app
CMD ["npm","run","run:prod"]
