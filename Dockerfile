FROM hassanamin994/node_ffmpeg:6
WORKDIR /exporter-service

COPY . .
RUN npm install

CMD ["npm", "run", "docker:prod"]