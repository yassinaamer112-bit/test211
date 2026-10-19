const app = require("../backend/server");

let databaseReady;

module.exports = async (req, res) => {
try {
if (!databaseReady) {
databaseReady = app.initializeDatabase();
}

    await databaseReady;
    return app(req, res);
} catch (error) {
    console.error("API error:", error);
    return res.status(500).json({
        success: false,
        message: "تعذر الاتصال بقاعدة البيانات."
    });
}

};