const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const pool = require("./database");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const path = require("path");

app.use(express.static(path.resolve(__dirname, "..")));

app.get("/", (req, res) => {
    res.sendFile(path.resolve(__dirname, "../index.html"));
});


const JWT_SECRET =
    process.env.JWT_SECRET || "local-development-secret-change-me";

const LOGIN_PASSWORDS = {
    admin: process.env.ADMIN_PASSWORD || "سعيد زكي",
    teacher: process.env.TEACHER_PASSWORD || "عماد الدين"
};

const PORT = process.env.PORT || 3000;

let databaseInitialization;

async function initializeDatabase() {
    if (!databaseInitialization) {
        databaseInitialization = pool.query(`
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
        `).then(() => {
            console.log("قاعدة البيانات جاهزة.");
        }).catch((error) => {
            databaseInitialization = null;
            throw error;
        });
    }

    return databaseInitialization;
}

function getStudents(value) {
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

function formatRecord(row) {
    return {
        id: row.id,
        grade: row.grade,
        className: row.class_name,
        subject: row.subject,
        date: row.date,
        period: row.period,
        totalStudents: Number(row.total_students),
        presentCount: Number(row.present_count),
        absentCount: Number(row.absent_count),
        students: getStudents(row.students_json),
        createdAt: row.created_at
    };
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "غير مصرح لك بالدخول."
        });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({
            success: false,
            message: "جلسة الدخول غير صالحة أو انتهت."
        });
    }
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({
                success: false,
                message: "ليس لديك صلاحية لتنفيذ هذا الطلب."
            });
        }

        next();
    };
}

app.get("/", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            success: true,
            message: "Attendance Server is working",
            database: "Connected successfully"
        });
    } catch (error) {
        console.error("Health error:", error.message);

        res.status(503).json({
            success: false,
            message: "تعذر الاتصال بقاعدة البيانات."
        });
    }
});

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            success: true,
            message: "Server is working",
            database: "Connected successfully"
        });
    } catch (error) {
        console.error("Health error:", error.message);

        res.status(503).json({
            success: false,
            message: "تعذر الاتصال بقاعدة البيانات."
        });
    }
});

app.post("/api/login", (req, res) => {
    const { role, password } = req.body || {};

    if (!role || !password) {
        return res.status(400).json({
            success: false,
            message: "من فضلك أدخل كلمة المرور."
        });
    }

    if (
        !Object.prototype.hasOwnProperty.call(LOGIN_PASSWORDS, role) ||
        password !== LOGIN_PASSWORDS[role]
    ) {
        return res.status(401).json({
            success: false,
            message: "كلمة المرور غير صحيحة."
        });
    }

    try {
        const token = jwt.sign(
            { role },
            JWT_SECRET,
            { expiresIn: "12h" }
        );

        return res.json({
            success: true,
            role,
            token,
            message: "تم تسجيل الدخول بنجاح."
        });
    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تسجيل الدخول."
        });
    }
});

app.post(
    "/api/attendance",
    authenticateToken,
    requireRole("teacher"),
    async (req, res) => {
        try {
            const {
                grade,
                className,
                subject,
                date,
                period,
                totalStudents,
                presentCount,
                absentCount,
                students
            } = req.body || {};

            if (
                !grade ||
                !className ||
                !subject ||
                !date ||
                period === undefined ||
                period === null ||
                !Array.isArray(students)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "بيانات الغياب غير مكتملة."
                });
            }

            const total = Number(totalStudents);
            const present = Number(presentCount);
            const absent = Number(absentCount);

            if (
                !Number.isInteger(total) ||
                !Number.isInteger(present) ||
                !Number.isInteger(absent) ||
                total < 0 ||
                present < 0 ||
                absent < 0 ||
                present + absent !== total ||
                students.length !== total
            ) {
                return res.status(400).json({
                    success: false,
                    message: "أعداد الطلاب والحضور والغياب غير متطابقة."
                });
            }

            const values = [
                String(grade),
                String(className),
                String(subject),
                String(date),
                String(period)
            ];

            const existing = await pool.query(
                `SELECT id
                 FROM attendance_records
                 WHERE grade = $1
                   AND class_name = $2
                   AND subject = $3
                   AND date = $4
                   AND period = $5
                 LIMIT 1`,
                values
            );

            if (existing.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: "تم تسجيل غياب هذه الحصة بالفعل."
                });
            }

            const createdAt = new Date().toISOString();

            const result = await pool.query(
                `INSERT INTO attendance_records (
                    grade, class_name, subject, date, period,
                    total_students, present_count, absent_count,
                    students_json, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
                RETURNING *`,
                [
                    ...values,
                    total,
                    present,
                    absent,
                    JSON.stringify(students),
                    createdAt
                ]
            );

            return res.json({
                success: true,
                message: "تم حفظ الغياب.",
                record: formatRecord(result.rows[0])
            });
        } catch (error) {
            console.error("Save attendance error:", error);

            return res.status(500).json({
                success: false,
                message: "حدث خطأ أثناء حفظ الغياب."
            });
        }
    }
);

app.get(
    "/api/attendance",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT *
                 FROM attendance_records
                 ORDER BY date DESC, id DESC`
            );

            return res.json({
                success: true,
                records: result.rows.map(formatRecord)
            });
        } catch (error) {
            console.error("Load attendance error:", error);

            return res.status(500).json({
                success: false,
                message: "حدث خطأ أثناء تحميل السجلات."
            });
        }
    }
);

app.get(
    "/api/attendance/weekly",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {
        try {
            const { startDate, endDate, grade, className } = req.query;

            if (!startDate || !endDate || !grade || !className) {
                return res.status(400).json({
                    success: false,
                    message: "يجب تحديد بداية الأسبوع ونهايته والصف والفصل."
                });
            }

            const result = await pool.query(
                `SELECT *
                 FROM attendance_records
                 WHERE date >= $1
                   AND date <= $2
                   AND grade = $3
                   AND class_name = $4
                 ORDER BY date ASC, period ASC`,
                [startDate, endDate, grade, className]
            );

            const studentsMap = new Map();

            for (const row of result.rows) {
                for (const student of getStudents(row.students_json)) {
                    if (!student.name) continue;

                    if (!studentsMap.has(student.name)) {
                        studentsMap.set(student.name, {
                            name: student.name,
                            specialization: student.specialization || "",
                            sunday: 0,
                            monday: 0,
                            tuesday: 0,
                            wednesday: 0,
                            thursday: 0,
                            total: 0
                        });
                    }

                    if (student.status === "absent") {
                        const day = new Date(
                            row.date + "T00:00:00"
                        ).getDay();

                        const dayKeys = [
                            "sunday",
                            "monday",
                            "tuesday",
                            "wednesday",
                            "thursday"
                        ];

                        if (day >= 0 && day <= 4) {
                            studentsMap.get(student.name)[dayKeys[day]]++;
                        }

                        studentsMap.get(student.name).total++;
                    }
                }
            }

            const totalLessons = result.rows.length;
            const totalPresent = result.rows.reduce(
                (sum, row) => sum + Number(row.present_count),
                0
            );
            const totalAbsent = result.rows.reduce(
                (sum, row) => sum + Number(row.absent_count),
                0
            );
            const totalAttendance = totalPresent + totalAbsent;

            const attendancePercentage = totalAttendance > 0
                ? Number(
                    ((totalPresent / totalAttendance) * 100).toFixed(2)
                )
                : 0;

            return res.json({
                success: true,
                filters: { startDate, endDate, grade, className },
                totalLessons,
                totalPresent,
                totalAbsent,
                attendancePercentage,
                students: Array.from(studentsMap.values())
            });
        } catch (error) {
            console.error("Weekly report error:", error);

            return res.status(500).json({
                success: false,
                message: "حدث خطأ أثناء إنشاء التقرير الأسبوعي."
            });
        }
    }
);

app.delete(
    "/api/attendance/:id",
    authenticateToken,
    requireRole("admin"),
    (req, res) => {
        return res.status(403).json({
            success: false,
            message: "حذف سجلات الغياب غير مسموح."
        });
    }
);

// Vercel يستخدم app.initializeDatabase داخل api/index.js
app.initializeDatabase = initializeDatabase;

if (require.main === module) {
    initializeDatabase()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`السيرفر يعمل على http://localhost:${PORT}`);
            });
        })
        .catch((error) => {
            console.error("فشل تشغيل السيرفر أو قاعدة البيانات:", error);
            process.exit(1);
        });
}

module.exports = app;