FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_USE_MOCKS=true
ENV VITE_USE_MOCKS=$VITE_USE_MOCKS
RUN npm run build

FROM nginx:1.27-alpine
ENV BACKEND_URL=http://api:8000
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
