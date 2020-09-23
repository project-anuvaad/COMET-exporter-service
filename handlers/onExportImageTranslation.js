const fs = require("fs");
const uuid = require("uuid").v4;
const path = require("path");

const { storageService } = require("../services");
const { queues } = require("../constants");
const fabric = require("fabric").fabric;

const onUpdateArticleVideoSpeed = (channel) => (msg) => {
  const {
    id,
    imageUrl,
    originalWidth,
    originalHeight,
    displayWidth,
    displayHeight,
    groups,
  } = JSON.parse(msg.content.toString());
  console.log('got request to export image translation', id, imageUrl)
  console.log({ originalHeight, originalWidth, displayHeight, displayWidth})
  const imagePath = path.join(__dirname, `${uuid()}.png`);
  const out = fs.createWriteStream(imagePath);
  // replace boxes with empty background
  canvas = new fabric.StaticCanvas(null, {
    width: originalWidth,
    height: originalHeight,
  });
  fabric.Image.fromURL(imageUrl, (oImg) => {
    canvas.setBackgroundImage(oImg);
    groups.forEach((group) => {
      const { width, height, top, left } = group;
      // const
      // originalWidth => ?
      // displayWidth => width
      const xScale = originalWidth / displayWidth;
      const yScale = originalHeight / displayHeight;
      const boxOriginalWidth = width * xScale;
      const boxOriginalLeft = left * xScale;
      const boxOriginalHeight = height * yScale;
      const boxOriginalTop = top * yScale;
      const groupObjects = [];

      group.objects.forEach((object) => {
        // Remove bounding box markers
        // and make the background fully opaq
        object.strokeWidth = 0;
        object.stroke = "";
        object.width = object.width * xScale;
        object.height = object.height * xScale;

        object.opacity = 1;
        switch (object.type) {
          case "circle":
            const circle = new fabric.Circle({
              ...object,
            });
            groupObjects.push(circle);
            break;
          case "ellipse":
            const oval = new fabric.Ellipse({
              ...object,
            });
            groupObjects.push(oval);
            break;
          case "rect":
            const rect = new fabric.Rect({
              ...object,
            });
            groupObjects.push(rect);
            break;
          case "text":
            const text = new fabric.Text(object.text || "", {
              ...object,
            });
            groupObjects.push(text);
            break;
          default:
            break;
        }
      });
      const { objects, ...rest } = group;
      const addedGroup = new fabric.Group(groupObjects, {
        ...rest,
        width: boxOriginalWidth,
        height: boxOriginalHeight,
        top: boxOriginalTop,
        left: boxOriginalLeft,
      });
      canvas.add(addedGroup);
    });
    canvas.renderAll();
    const stream = canvas.createPNGStream();
    stream.on("data", function (chunk) {
      out.write(chunk);
    });
    stream.on("end", function () {
      console.log("uploading image");
      storageService
        .saveFile(
          "images/translations",
          imagePath.split("/").pop(),
          fs.createReadStream(imagePath)
        )
        .then((uploadRes) => {
          channel.sendToQueue(
            queues.EXPORT_IMAGE_TRANSLATION_FINISH_QUEUE,
            Buffer.from(
              JSON.stringify({ id, url: uploadRes.url, Key: uploadRes.Key })
            )
          );
          channel.ack(msg)
          fs.unlink(imagePath, () => {});
        })
        .catch((err) => {
          console.log(err);
          channel.ack(msg);
          channel.sendToQueue(
            queues.EXPORT_IMAGE_TRANSLATION_FINISH_QUEUE,
            Buffer.from(
              JSON.stringify({ id, status: 'failed' })
            )
          );
          fs.unlink(imagePath, () => {});
        });
    });
  });
};

module.exports = onUpdateArticleVideoSpeed;
