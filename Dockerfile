FROM nginx:alpine

COPY web/ /usr/share/nginx/html/web/

RUN cat > /etc/nginx/conf.d/default.conf <<'CONF'
map $http_x_forwarded_proto $proxy_scheme {
    default $http_x_forwarded_proto;
    ''      $scheme;
}

server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    location = / {
        return 302 $proxy_scheme://$http_host/web/;
    }

    location /web/ {
        try_files $uri $uri/ /web/index.html;
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
