FROM nginx:alpine

COPY web/ /usr/share/nginx/html/

RUN cat > /etc/nginx/conf.d/default.conf <<'CONF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate";
    }

    include /etc/nginx/mime.types;
    types {
        application/javascript mjs;
    }

    location ~* \.(js|mjs|css|svg|png|ico|json)$ {
        expires 1h;
        add_header Cache-Control "public, immutable";
    }
}
CONF

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
