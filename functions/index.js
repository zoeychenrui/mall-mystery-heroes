const express = require("express");
const cors = require("cors");

var corsOptions = {
    origin: "http://localhost:3000"
  };

const app = express();
app.use(cors({ corsOptions }));

const { targetFunction } = require("./callableFunctions/targetFunction")
exports.targetFunction = targetFunction