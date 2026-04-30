FROM ghcr.io/maplibre/martin:1.7.0

EXPOSE 10000

CMD ["sh", "-c", "martin --listen-addresses 0.0.0.0:${PORT:-10000} --webui enable-for-all"]