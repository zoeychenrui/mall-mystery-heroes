const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

exports.targetFunction = functions.https.onCall((data, context) => {
    console.log("Function called with data:", data);

    if (!context.auth) {
        console.error("User not authenticated.");
        throw new functions.https.HttpsError(
            "unauthenticated",
            "The function must be called while authenticated."
        );
    }

    return {
        success: true,
        message: "Function executed successfully",
        receivedData: data
    };
});
