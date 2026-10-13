const express = require("express");
const cors = require("cors");

var corsOptions = {
    origin: "http://localhost:3000"
  };

const app = express();
app.use(cors({ corsOptions }));

const { killPlayer } = require("./callableFunctions/killPlayer")
exports.killPlayer = killPlayer

const { undoKillPlayer } = require("./callableFunctions/undoKillPlayer")
exports.undoKillPlayer = undoKillPlayer

const { joinRoom } = require("./callableFunctions/joinRoom")
exports.joinRoom = joinRoom

const { submitKillPhoto } = require("./callableFunctions/submitKillPhoto")
exports.submitKillPhoto = submitKillPhoto

const { submitChatMessage } = require("./callableFunctions/submitChatMessage")
exports.submitChatMessage = submitChatMessage

const { completeMission } = require("./callableFunctions/completeMission")
exports.completeMission = completeMission

const { undoMissionPhotoApproval, undoMissionCommand } = require("./callableFunctions/undoMissionCompletion")
exports.undoMissionPhotoApproval = undoMissionPhotoApproval
exports.undoMissionCommand = undoMissionCommand

const { leaveGame, removePlayer } = require("./callableFunctions/removePlayer")
exports.leaveGame = leaveGame
exports.removePlayer = removePlayer

const { requestReconnect, approveReconnectRequest, denyReconnectRequest } = require("./callableFunctions/reconnectRequest")
exports.requestReconnect = requestReconnect
exports.approveReconnectRequest = approveReconnectRequest
exports.denyReconnectRequest = denyReconnectRequest

const { publishGameBoundary, disableGameBoundary } = require('./callableFunctions/gameBoundary')
exports.publishGameBoundary = publishGameBoundary
exports.disableGameBoundary = disableGameBoundary

const { reportPlayerLocation } = require('./callableFunctions/reportPlayerLocation')
exports.reportPlayerLocation = reportPlayerLocation

const { endGame } = require('./callableFunctions/endGame')
exports.endGame = endGame

const { cleanupEndedRooms } = require("./scheduledFunctions/cleanupEndedRooms")
exports.cleanupEndedRooms = cleanupEndedRooms