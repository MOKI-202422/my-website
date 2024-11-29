const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = 3310;

app.use(express.static("public"));

const quizQuestions = [
    {
        question: "日本の首都はどこ？",
        choices: ["大阪", "東京", "京都", "札幌"],
        answer: "東京"
    },
    {
        question: "1+1は何？",
        choices: ["1", "2", "3", "4"],
        answer: "2"
    },
    {
        question: "地球で一番高い山は？",
        choices: ["富士山", "エベレスト", "キリマンジャロ", "アンデス山脈"],
        answer: "エベレスト"
    }
];

const rooms = {}; // ルームごとの状態を管理

io.on("connection", (socket) => {
    console.log("ユーザーが接続しました:", socket.id);

    socket.on("join_room", (roomName, playerName) => {
        socket.join(roomName);

        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: {}, // プレイヤーごとのスコア
                readyPlayers: new Set(),
                currentQuestionIndex: 0,
                timer: null,
                questionStartTime: null,
                timeLeft: 30,
                hasAnswered: false,
                isAnswerRevealed: false,
                wrongAnswers: {}, // 不正解のプレイヤーを追跡
            };
        }

        rooms[roomName].players[playerName] = 0; // スコアを初期化
        io.to(roomName).emit("player_list", Object.entries(rooms[roomName].players));
    });

    socket.on("player_ready", ({ roomName, playerName }) => {
        const room = rooms[roomName];
        if (!room) return;

        room.readyPlayers.add(playerName);

        if (room.readyPlayers.size === Object.keys(room.players).length) {
            io.to(roomName).emit("all_ready");
        }
    });

    socket.on("start_quiz", (roomName) => {
        const room = rooms[roomName];
        if (!room) return;

        room.currentQuestionIndex = 0;
        room.readyPlayers.clear();
        room.wrongAnswers = {}; // 新しい問題でリセット
        sendQuestion(roomName);
    });

    socket.on("answer", (data) => {
        const { roomName, playerName, answer } = data;
        const room = rooms[roomName];
        if (!room) return;

        const currentQuestionIndex = room.currentQuestionIndex;

        // 不正解済みチェック
        if (room.wrongAnswers[playerName] && room.wrongAnswers[playerName].includes(currentQuestionIndex)) {
            socket.emit("already_answered", {
                message: "この問題にはすでに不正解です。",
            });
            return;
        }

        const currentQuestion = quizQuestions[currentQuestionIndex];

        if (answer === currentQuestion.answer) {
            // スコアを加算
            room.players[playerName] += 1;
            io.to(roomName).emit("update_scores", room.players);

            io.to(roomName).emit("correct_answer", {
                isAnswerReveal: false,
                playerName,
                answer,
            });

            if (room.timer) clearInterval(room.timer);
            room.currentQuestionIndex++;
            room.wrongAnswers = {}; // 次の問題に移るためリセット
            setTimeout(() => sendQuestion(roomName), 2000);
        } else {
            // 不正解を記録
            if (!room.wrongAnswers[playerName]) {
                room.wrongAnswers[playerName] = [];
            }
            room.wrongAnswers[playerName].push(currentQuestionIndex);

            io.to(roomName).emit("wrong_answer", { playerName, answer });

            // 全員が不正解かどうかを確認
            if (Object.keys(room.wrongAnswers).length === Object.keys(room.players).length) {
                if (room.timer) clearInterval(room.timer);

                io.to(roomName).emit("correct_answer", {
                    isAnswerReveal: true,
                    answer: currentQuestion.answer,
                });

                setTimeout(() => {
                    room.currentQuestionIndex++;
                    sendQuestion(roomName);
                }, 2000);
            }
        }
    });

    socket.on("disconnect", () => {
        for (const roomName in rooms) {
            const room = rooms[roomName];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                room.readyPlayers.delete(room.players[socket.id]);
                io.to(roomName).emit("player_list", Object.entries(room.players));
            }
        }
    });

    function sendQuestion(roomName) {
        const room = rooms[roomName];
        if (!room || room.currentQuestionIndex >= quizQuestions.length) {
            io.to(roomName).emit("end_quiz", "クイズ終了！");
            return;
        }

        const currentQuestion = quizQuestions[room.currentQuestionIndex];
        room.timeLeft = 30;
        room.questionStartTime = Date.now();
        room.hasAnswered = false;
        room.isAnswerRevealed = false;
        room.wrongAnswers = {}; // 新しい問題のためリセット

        io.to(roomName).emit("question", {
            question: currentQuestion.question,
            choices: currentQuestion.choices,
        });

        startTimer(roomName);
    }

    function startTimer(roomName) {
        const room = rooms[roomName];
        if (!room) return;

        room.timer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - room.questionStartTime) / 1000);
            room.timeLeft = Math.max(30 - elapsed, 0);
            io.to(roomName).emit("timer_update", room.timeLeft);

            if (room.timeLeft === 0) {
                clearInterval(room.timer);

                const currentQuestion = quizQuestions[room.currentQuestionIndex];

                if (!room.hasAnswered && !room.isAnswerRevealed) {
                    io.to(roomName).emit("correct_answer", {
                        isAnswerReveal: true,
                        answer: currentQuestion.answer,
                    });
                    room.isAnswerRevealed = true;

                    setTimeout(() => {
                        room.currentQuestionIndex++;
                        sendQuestion(roomName);
                    }, 2000);
                }
            }
        }, 1000);
    }
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
