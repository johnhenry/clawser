FROM nginx:alpine

COPY web/ /usr/share/nginx/html/web/

# Simple nginx config for SPA with proper MIME types
RUN cat > /etc/nginx/conf.d/default.conf <<'CONF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    location /web/ {
        try_files $uri $uri/ /web/index.html;
        add_header Cache-Control "no-cache, must-revalidate";
    }

    location ~* \.(js|css|svg|png|ico|json)$ {
        expires 1h;
        add_header Cache-Control "public, immutable";
    }

    # Proper MIME for ES modules
    types {
        application/javascript js mjs;
    }
}
CONF

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
