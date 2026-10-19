const API_URL = "http://localhost:3000";

const form = document.getElementById("teacherLoginForm");
const passwordInput = document.getElementById("teacherPassword");
const message = document.getElementById("teacherLoginMessage");

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = passwordInput.value.trim();

    message.textContent = "جاري التحقق...";
    message.style.color = "#777";

    try {
        const response = await fetch(`${API_URL}/api/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                role: "teacher",
                password
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            message.textContent = data.message || "فشل تسجيل الدخول.";
            message.style.color = "#d93025";
            return;
        }

        localStorage.setItem("attendanceToken", data.token);
        localStorage.setItem("attendanceRole", data.role);

        message.textContent = "تم تسجيل الدخول بنجاح";
        message.style.color = "#188038";

        setTimeout(() => {
            window.location.href = "teacher.html";
        }, 500);

    } catch (error) {
        console.error("Login error:", error);

        message.textContent = "تعذر الاتصال بالسيرفر.";
        message.style.color = "#d93025";
    }
});