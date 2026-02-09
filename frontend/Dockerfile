# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Build args for API URLs
ARG VITE_API_URL=https://gayauth228gay.duckdns.org
ARG VITE_WS_URL=wss://gayauth228gay.duckdns.org

# Set as env for vite build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
