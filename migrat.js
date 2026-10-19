const Database = require("better-sqlite3");
const pool = require("./database");
const path = require("path");

async function migrate() {
    const db = new Database(
        path.join(__dirname, "attendance.db"),
        {
            readonly: true,
            fileMustExist: true
        }
    );

    let client;

    try {
        const records = db
            .prepare("SELECT * FROM attendance_records ORDER BY id")
            .all();

        console.log(`عدد السجلات القديمة: ${records.length}`);

        client = await pool.connect();

        await client.query(`
            CREATE TABLE IF NOT EXISTS attendance_records (
                id BIGSERIAL PRIMARY KEY,
                grade TEXT NOT NULL,
                class_name TEXT NOT NULL,
                subject TEXT NOT NULL,
                date TEXT NOT NULL,
                period TEXT NOT NULL,
                total_students INTEGER NOT NULL,
                present_count INTEGER NOT NULL,
                absent_count INTEGER NOT NULL,
                students_json JSONB NOT NULL,
                created_at TEXT NOT NULL
            )
        `);

        await client.query("BEGIN");

        try {
            for (const record of records) {
                const students =
                    typeof record.students_json === "string"
                        ? JSON.parse(record.students_json)
                        : record.students_json;

                await client.query(
                    `INSERT INTO attendance_records (
                        id, grade, class_name, subject, date, period,
                        total_students, present_count, absent_count,
                        students_json, created_at
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6,
                        $7, $8, $9, $10::jsonb, $11
                    )
                    ON CONFLICT (id) DO NOTHING`,
                    [
                        record.id,
                        record.grade,
                        record.class_name,
                        record.subject,
                        record.date,
                        record.period,
                        record.total_students,
                        record.present_count,
                        record.absent_count,
                        JSON.stringify(students),
                        record.created_at
                    ]
                );
            }

            await client.query(`
                SELECT setval(
                    pg_get_serial_sequence(
                        'attendance_records',
                        'id'
                    ),
                    COALESCE(
                        (SELECT MAX(id) FROM attendance_records),
                        1
                    ),
                    EXISTS (
                        SELECT 1 FROM attendance_records
                    )
                )
            `);

            await client.query("COMMIT");

            console.log("تم نقل السجلات بنجاح.");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
    } finally {
        db.close();

        if (client) {
            client.release();
        }

        await pool.end();
    }
}

migrate().catch(error => {
    console.error("فشل نقل السجلات:", error.message);
    process.exitCode = 1;
});