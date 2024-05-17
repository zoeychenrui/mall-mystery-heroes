const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors({ origin: true }));

const { targetFunction } = require("./callableFunctions/targetFunction")
exports.targetFunction = targetFunction