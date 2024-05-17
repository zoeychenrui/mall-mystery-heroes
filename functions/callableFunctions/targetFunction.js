const functions = require("firebase-functions");
const admin = require("firebase-admin");

if(admin.apps.length === 0) {
    admin.initializeApp();
}

// sample function
exports.myFunction = functions
// .runWith({ timeoutSeconds: 540 })
    .https.onCall(async (data, context) => {
        if(!data || !context.auth) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "Missing required fields: data object and/or user ID."
            );
        }

        try {
            return {
                success: true
            };
        } catch (error) {
            console.error("Error calling targetFunction:", error);
            throw new functions.https.HttpsError(
                "internal",
                "Internal server error."
            );
        }
    });