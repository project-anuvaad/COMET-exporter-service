FROM hassanamin994/node_ffmpeg:6
WORKDIR /exporter-service

COPY . .
RUN npm install

EXPOSE 4000
CMD ["npm", "run", "docker:prod"]