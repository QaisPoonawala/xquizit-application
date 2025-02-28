// Global variables
let currentQuizId = null;
let lastQuizId = null;
let allQuizzes = [];

// Function to add a new question to the quiz form
function addQuestion() {
    const questionsContainer = document.getElementById('questionsContainer');
    const questionNumber = questionsContainer.children.length + 1;

    const questionHTML = `
        <div class="question-container">
            <h3>Question ${questionNumber}</h3>
            <div class="form-group">
                <label>Question Text:</label>
                <input type="text" class="question-text" required>
            </div>
            <div class="form-group">
                <label>Time Limit (seconds):</label>
                <input type="number" class="time-limit" value="30" min="5" max="300" required>
            </div>
            <div class="form-group">
                <label>Image (optional):</label>
                <input type="file" class="question-image" accept="image/*" onchange="previewImage(this)">
                <div class="image-preview"></div>
            </div>
            <div class="options-container">
                <h4>Options</h4>
                <div class="option">
                    <input type="text" placeholder="Option 1" required>
                    <label>
                        <input type="checkbox" class="correct-option"> Correct
                    </label>
                </div>
                <div class="option">
                    <input type="text" placeholder="Option 2" required>
                    <label>
                        <input type="checkbox" class="correct-option"> Correct
                    </label>
                </div>
            </div>
            <button type="button" onclick="addOption(this)">Add Option</button>
            <button type="button" class="remove-question" onclick="removeQuestion(this)">Remove Question</button>
        </div>
    `;

    questionsContainer.insertAdjacentHTML('beforeend', questionHTML);
}

// Function to preview uploaded image
function previewImage(input) {
    const preview = input.parentElement.querySelector('.image-preview');
    const file = input.files[0];
    
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.innerHTML = `<img src="${e.target.result}" alt="Question image">`;
        };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = '';
    }
}

// Function to add a new option to a question
function addOption(button) {
    const optionsContainer = button.previousElementSibling;
    const optionNumber = optionsContainer.children.length + 1;
    
    const optionHTML = `
        <div class="option">
            <input type="text" placeholder="Option ${optionNumber}" required>
            <label>
                <input type="checkbox" class="correct-option"> Correct
            </label>
            <button type="button" onclick="removeOption(this)">Remove</button>
        </div>
    `;
    
    optionsContainer.insertAdjacentHTML('beforeend', optionHTML);
}

// Function to remove an option
function removeOption(button) {
    const option = button.parentElement;
    const optionsContainer = option.parentElement;
    
    if (optionsContainer.children.length > 2) {
        option.remove();
    } else {
        alert('A question must have at least 2 options');
    }
}

// Function to remove a question
function removeQuestion(button) {
    const questionContainer = button.parentElement;
    const questionsContainer = questionContainer.parentElement;
    
    questionContainer.remove();
    
    // Update question numbers
    const questions = questionsContainer.querySelectorAll('.question-container');
    questions.forEach((question, index) => {
        question.querySelector('h3').textContent = `Question ${index + 1}`;
    });
}

// Function to show quiz form
function showQuizForm() {
    document.getElementById('quizList').style.display = 'none';
    document.getElementById('quizForm').style.display = 'block';
    document.getElementById('liveQuizControl').style.display = 'none';
}

// Socket connection and state
let socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
});
let sessionId = null;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

// Add connection status indicator
const statusDiv = document.createElement('div');
statusDiv.id = 'connectionStatus';
statusDiv.style.position = 'fixed';
statusDiv.style.top = '10px';
statusDiv.style.right = '10px';
statusDiv.style.padding = '5px 10px';
statusDiv.style.borderRadius = '5px';
statusDiv.style.zIndex = '1000';
document.body.appendChild(statusDiv);

const updateConnectionStatus = (status, message = '') => {
    const statusDiv = document.getElementById('connectionStatus');
    if (statusDiv) {
        statusDiv.textContent = status;
        statusDiv.style.backgroundColor = status === 'Connected' ? '#4CAF50' : '#f44336';
        statusDiv.style.color = 'white';
        if (message) {
            console.log(`Connection status: ${status} - ${message}`);
        }
    }
};

// Enhanced socket connection events
socket.on('connect', () => {
    console.log('Socket connected');
    isConnected = true;
    reconnectAttempts = 0;
    updateConnectionStatus('Connected');

    // If we have a sessionId, attempt to reconnect to the quiz
    if (sessionId) {
        fetch('/api/live/reconnect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sessionId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('Successfully reconnected to quiz');
                // Re-join the quiz room
                socket.emit('join-quiz', { sessionId });
            }
        })
        .catch(error => {
            console.error('Error reconnecting to quiz:', error);
            updateConnectionStatus('Error', 'Failed to reconnect to quiz');
        });
    }
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    updateConnectionStatus('Disconnected', 'Connection error');
});

socket.on('connect_timeout', () => {
    console.error('Connection timeout');
    updateConnectionStatus('Disconnected', 'Connection timeout');
});

socket.on('disconnect', () => {
    console.log('Socket disconnected');
    isConnected = false;

    // Notify server about disconnection if we have a sessionId
    if (sessionId) {
        fetch('/api/live/disconnect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sessionId })
        })
        .catch(error => {
            console.error('Error notifying server about disconnection:', error);
        });
    }

    // Attempt to reconnect
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(() => {
            console.log(`Attempting to reconnect (attempt ${reconnectAttempts})`);
            socket.connect();
        }, 1000 * reconnectAttempts); // Exponential backoff
    }
});

socket.on('participant-count', (data) => {
    console.log('Received participant count:', data);
    const participantCount = document.getElementById('participantNumber');
    const participantNames = document.getElementById('participantNames');
    const currentQuestion = document.getElementById('currentQuestionNumber');
    
    try {
        if (participantCount) {
            participantCount.textContent = data.count || '0';
        }
        if (participantNames && data.participants) {
            participantNames.innerHTML = data.participants
                .map(p => `<span class="participant-name">${p.name}</span>`)
                .join(' ');
        }
        if (currentQuestion && data.currentQuestion !== undefined) {
            currentQuestion.textContent = (data.currentQuestion + 1).toString();
        }
    } catch (error) {
        console.error('Error updating participant information:', error);
    }
});

socket.on('quiz-joined', (data) => {
    // Store sessionId when joining a quiz
    if (data.sessionId) {
        sessionId = data.sessionId;
    }
    console.log('Quiz joined event:', data);
    if (data.currentQuestion >= 0) {
        document.getElementById('currentQuestionNumber').textContent = data.currentQuestion + 1;
    }
});

// Timer variables
let timerInterval;
let remainingTime;

socket.on('new-question', (data) => {
    console.log('New question event:', data);
    const currentQuestionNumber = document.getElementById('currentQuestionNumber');
    const questionDisplay = document.getElementById('questionDisplay');
    
    if (currentQuestionNumber) {
        const questionNum = parseInt(currentQuestionNumber.textContent);
        if (!isNaN(questionNum)) {
            // Show current question number and total questions
            const totalQuestions = data.totalQuestions || data.question.totalQuestions;
            currentQuestionNumber.textContent = `${questionNum}/${totalQuestions}`;
        }
    }

    // Clear any existing timer
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    // Display current question details
    if (questionDisplay && data.question) {
        // Set initial timer value
        remainingTime = data.timeLimit;
        
        questionDisplay.innerHTML = `
            <div class="current-question">
                <h3>Current Question</h3>
                <p class="question-text">${data.question.questionText}</p>
                <div class="time-limit">Time Remaining: <span id="countdown">${remainingTime}</span> seconds</div>
                <div class="options-list">
                    ${data.question.options.map((option, index) => `
                        <div class="option" data-correct="${option.isCorrect}">
                            <span class="option-letter">${String.fromCharCode(65 + index)}.</span>
                            <span class="option-text">${option.text}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Start countdown timer
        const countdownElement = document.getElementById('countdown');
        timerInterval = setInterval(() => {
            remainingTime--;
            if (countdownElement) {
                countdownElement.textContent = remainingTime;
            }
            if (remainingTime <= 0) {
                clearInterval(timerInterval);
                // Highlight correct answers when time expires
                const options = document.querySelectorAll('.option');
                options.forEach(option => {
                    if (option.dataset.correct === 'true') {
                        option.classList.add('highlight-correct');
                    }
                });
            }
        }, 1000);
    }
});

// Add visual feedback for answers
socket.on('answer-result', (data) => {
    const options = document.querySelectorAll('.option');
    options.forEach(option => {
        if (data.correct) {
            if (option.dataset.correct === 'true') {
                option.classList.add('correct-answer');
            }
        } else {
            if (option.dataset.correct === 'true') {
                option.classList.add('correct-answer');
            }
            if (option.dataset.correct === 'false') {
                option.classList.add('wrong-answer');
            }
        }
    });
});

socket.on('leaderboard-update', (leaderboardData) => {
    const leaderboardList = document.getElementById('liveLeaderboardList');
    if (leaderboardList) {
        leaderboardList.innerHTML = leaderboardData
            .map((participant) => `
                <div class="leaderboard-entry ${participant.rank <= 3 ? 'top-three' : ''}">
                    <span class="name">${participant.name}</span>
                    <span class="score">${participant.score}</span>
                    <div class="stats">
                        <span class="answered">${participant.answeredQuestions} answered</span>
                        <span class="correct">${participant.correctAnswers} correct</span>
                    </div>
                </div>
            `).join('');
    }
});

// Function to show quiz list
function showQuizzes() {
    document.getElementById('quizList').style.display = 'block';
    document.getElementById('quizForm').style.display = 'none';
    document.getElementById('liveQuizControl').style.display = 'none';
    loadQuizzes();
}

// Function to filter and display quizzes
function filterAndDisplayQuizzes() {
    const searchInput = document.getElementById('searchInput').value.toLowerCase();
    const filteredQuizzes = allQuizzes.filter(quiz => 
        quiz.title.toLowerCase().includes(searchInput) ||
        quiz.description.toLowerCase().includes(searchInput)
    );
    
    const container = document.getElementById('quizzesContainer');
    container.innerHTML = '';
    
    filteredQuizzes.forEach(quiz => {
        const quizCard = `
            <div class="quiz-card">
                <div class="quiz-header">
                    <h3>${quiz.title}</h3>
                    <div class="quiz-actions">
                        <button onclick="startLiveQuiz('${quiz.id}')">Start Live</button>
                        <button onclick="editQuiz('${quiz.id}')">Edit</button>
                        <button onclick="copyQuiz('${quiz.id}')">Copy</button>
                        <button onclick="deleteQuiz('${quiz.id}')">Delete</button>
                    </div>
                </div>
                <p>${quiz.description}</p>
                <div class="quiz-meta">
                    <span>${quiz.questions.length} Questions</span>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', quizCard);
    });
}

// Update all remaining fetch requests to use the correct '/api/quizzes' endpoint
async function loadQuizzes() {
    try {
        const response = await fetch('/api/quiz');
        const data = await response.json();
        allQuizzes = data.data;
        filterAndDisplayQuizzes();
    } catch (error) {
        console.error('Error loading quizzes:', error);
        alert('Failed to load quizzes. Please check the console for details.');
    }
}

// Quiz form submission handler
document.getElementById('createQuizForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const form = e.target;
    const editQuizId = form.dataset.editQuizId;

    const quiz = {
        title: document.getElementById('quizTitle').value,
        description: document.getElementById('quizDescription').value,
        theme: {
            backgroundColor: document.getElementById('backgroundColor').value,
            textColor: document.getElementById('textColor').value,
            accentColor: document.getElementById('accentColor').value
        },
        questions: []
    };

    // Validate title
    if (!quiz.title.trim()) {
        alert('Quiz title is required');
        return;
    }

    // Get questions
    const questionContainers = document.querySelectorAll('.question-container');
    
    if (questionContainers.length === 0) {
        alert('Please add at least one question to the quiz');
        return;
    }

    questionContainers.forEach(questionContainer => {
        const questionText = questionContainer.querySelector('.question-text').value.trim();
        
        if (!questionText) {
            alert('Each question must have a question text');
            return;
        }

        const timeLimit = parseInt(questionContainer.querySelector('.time-limit').value);
        const options = [];
        
        const optionContainers = questionContainer.querySelectorAll('.option');
        const checkedOptions = Array.from(optionContainers).filter(option => 
            option.querySelector('.correct-option').checked
        );

        if (checkedOptions.length === 0) {
            alert('Each question must have at least one correct option');
            return;
        }

        optionContainers.forEach(option => {
            const optionText = option.querySelector('input[type="text"]').value.trim();
            
            if (!optionText) {
                alert('Option text cannot be empty');
                return;
            }

            options.push({
                text: optionText,
                isCorrect: option.querySelector('.correct-option').checked
            });
        });

        const imagePreview = questionContainer.querySelector('.image-preview img');
        const imageUrl = imagePreview ? imagePreview.src : null;

        quiz.questions.push({
            questionText,
            timeLimit,
            options,
            imageUrl
        });
    });

    try {
        console.log('Sending quiz request with payload:', JSON.stringify(quiz, null, 2));
        
        const url = editQuizId ? `/api/quiz/${editQuizId}` : '/api/quiz';
        const method = editQuizId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(quiz)
        });

        const responseData = await response.json();

        if (response.ok) {
            console.log('Quiz operation successful:', responseData);
            alert(editQuizId ? 'Quiz updated successfully!' : 'Quiz created successfully!');
            document.getElementById('createQuizForm').reset();
            document.getElementById('questionsContainer').innerHTML = ''; // Clear questions
            form.removeAttribute('data-edit-quiz-id'); // Clear the edit ID
            showQuizzes();
        } else {
            console.error('Quiz operation failed:', responseData);
            alert(`Error ${editQuizId ? 'updating' : 'creating'} quiz: ${responseData.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error(`Error ${editQuizId ? 'updating' : 'creating'} quiz:`, error);
        alert(`Error ${editQuizId ? 'updating' : 'creating'} quiz. Please check the console for details.`);
    }
});

// Update other functions to use '/api/quizzes'
async function startLiveQuiz(id) {
    try {
        const response = await fetch(`/api/live/start/${id}`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            currentQuizId = id;
            document.getElementById('quizList').style.display = 'none';
            document.getElementById('quizForm').style.display = 'none';
            document.getElementById('liveQuizControl').style.display = 'block';
            
            // Apply theme if available
            const quiz = allQuizzes.find(q => q.id === id);
            if (quiz && quiz.theme) {
                applyTheme(quiz.theme);
            }
            
            // Reset UI elements
            document.getElementById('sessionCode').textContent = data.data.sessionCode;
            document.getElementById('currentQuestionNumber').textContent = '0';
            document.getElementById('totalQuestions').textContent = quiz.questions.length.toString();
            document.getElementById('nextQuestionBtn').textContent = 'Start Quiz';
            document.getElementById('participantNumber').textContent = '0';
            document.getElementById('participantNames').innerHTML = '';
            document.getElementById('liveLeaderboardList').innerHTML = '';
            
            // Show control buttons
            document.getElementById('downloadReportBtn').style.display = 'block';
            document.getElementById('endQuizBtn').style.display = 'block';
            
            console.log('Emitting host-quiz event for quiz:', id);
            socket.emit('host-quiz', { quizId: id });
            
            // Generate QR code
            const qrDiv = document.getElementById('qrCode');
            qrDiv.innerHTML = '<h3>Scan to Join</h3>';
            const qrImg = document.createElement('img');
            qrDiv.appendChild(qrImg);
            
            const joinUrl = `${window.location.origin}/join.html`;
            QRCode.toDataURL(joinUrl, function (err, url) {
                if (!err) {
                    qrImg.src = url;
                }
            });
        }
    } catch (error) {
        console.error('Error starting live quiz:', error);
        alert('Error starting live quiz. Please check the console for details.');
    }
}

async function nextQuestion() {
    try {
        const response = await fetch(`/api/live/next/${currentQuizId}`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            if (data.finished) {
                await endQuiz();
                return;
            }

            const currentNum = parseInt(document.getElementById('currentQuestionNumber').textContent) + 1;
            document.getElementById('currentQuestionNumber').textContent = currentNum.toString();
            document.getElementById('nextQuestionBtn').textContent = 'Next Question';
        } else {
            console.error('Next question failed:', data);
            alert(`Error moving to next question: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error moving to next question:', error);
        alert('Error moving to next question. Please check the console for details.');
    }
}

async function endQuiz() {
    if (!confirm('Are you sure you want to end this quiz?')) {
        return;
    }

    try {
        console.log('Ending quiz:', currentQuizId);

        // End the quiz and get final data
        const endResponse = await fetch(`/api/quiz/${currentQuizId}/end`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const endData = await endResponse.json();
        
        if (!endData.success) {
            throw new Error('Failed to end quiz');
        }
        
        console.log('Quiz ended successfully:', endData);

        // Hide quiz control panel
        document.getElementById('liveQuizControl').style.display = 'none';

        // Store the quiz ID before resetting currentQuizId
        lastQuizId = currentQuizId;

        // Show winners using the winners data from the end quiz response
        showWinners(endData.data.winners);
        
        // Reset quiz state
        socket.emit('quiz-ended', { quizId: currentQuizId });
        currentQuizId = null;

        console.log('Quiz end process completed');
    } catch (error) {
        console.error('Error ending quiz:', error);
        alert('Error ending quiz. Please check the console for details.');
    }
}

async function downloadReport() {
    try {
        // Use lastQuizId if currentQuizId is null
        const quizId = currentQuizId || lastQuizId;
        if (!quizId) {
            throw new Error('No quiz ID available');
        }

        console.log('Downloading report for quiz:', quizId);
        const response = await fetch(`/api/live/report/${quizId}`);
        
        // Check if response is ok
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to download report');
        }

        // Get filename from Content-Disposition header
        const contentDisposition = response.headers.get('Content-Disposition');
        const filename = contentDisposition
            ? contentDisposition.split('filename=')[1].replace(/"/g, '')
            : 'quiz-results.xlsx';

        // Convert response to blob
        const blob = await response.blob();
        
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        
        // Trigger download
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        console.error('Error downloading report:', error);
        alert('Error downloading report. Please check the console for details.');
    }
}

// Theme application
function applyTheme(theme) {
    const root = document.documentElement;
    root.style.setProperty('--background-color', theme.backgroundColor || '#ffffff');
    root.style.setProperty('--text-color', theme.textColor || '#333333');
    root.style.setProperty('--accent-color', theme.accentColor || '#007bff');
}

async function editQuiz(id) {
    try {
        const quiz = allQuizzes.find(q => q.id === id);
        if (!quiz) {
            alert('Quiz not found');
            return;
        }

        // Clear existing form data
        document.getElementById('createQuizForm').reset();
        document.getElementById('questionsContainer').innerHTML = '';

        // Show quiz form and add cancel button
        document.getElementById('quizList').style.display = 'none';
        document.getElementById('quizForm').style.display = 'block';
        document.getElementById('liveQuizControl').style.display = 'none';

        // Add cancel button if not already present
        let cancelBtn = document.querySelector('.cancel-edit-btn');
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.className = 'cancel-edit-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => {
                document.getElementById('createQuizForm').reset();
                document.getElementById('questionsContainer').innerHTML = '';
                showQuizzes();
            };
            document.getElementById('createQuizForm').insertBefore(cancelBtn, document.getElementById('createQuizForm').firstChild);
        }

        // Fill form with quiz data
        document.getElementById('quizTitle').value = quiz.title;
        document.getElementById('quizDescription').value = quiz.description;
        document.getElementById('backgroundColor').value = quiz.theme?.backgroundColor || '#ffffff';
        document.getElementById('textColor').value = quiz.theme?.textColor || '#333333';
        document.getElementById('accentColor').value = quiz.theme?.accentColor || '#007bff';

        // Add questions
        quiz.questions.forEach(question => {
            const questionsContainer = document.getElementById('questionsContainer');
            const questionNumber = questionsContainer.children.length + 1;

            const questionHTML = `
                <div class="question-container">
                    <h3>Question ${questionNumber}</h3>
                    <div class="form-group">
                        <label>Question Text:</label>
                        <input type="text" class="question-text" value="${question.questionText}" required>
                    </div>
                    <div class="form-group">
                        <label>Time Limit (seconds):</label>
                        <input type="number" class="time-limit" value="${question.timeLimit}" min="5" max="300" required>
                    </div>
                    <div class="form-group">
                        <label>Image (optional):</label>
                        <input type="file" class="question-image" accept="image/*" onchange="previewImage(this)">
                        <div class="image-preview">
                            ${question.imageUrl ? `<img src="${question.imageUrl}" alt="Question image">` : ''}
                        </div>
                    </div>
                    <div class="options-container">
                        <h4>Options</h4>
                        ${question.options.map((option, index) => `
                            <div class="option">
                                <input type="text" placeholder="Option ${index + 1}" value="${option.text}" required>
                                <label>
                                    <input type="checkbox" class="correct-option" ${option.isCorrect ? 'checked' : ''}> Correct
                                </label>
                                ${index > 1 ? '<button type="button" onclick="removeOption(this)">Remove</button>' : ''}
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" onclick="addOption(this)">Add Option</button>
                    <button type="button" class="remove-question" onclick="removeQuestion(this)">Remove Question</button>
                </div>
            `;
            questionsContainer.insertAdjacentHTML('beforeend', questionHTML);
        });

        // Store the quiz ID being edited
        document.getElementById('createQuizForm').dataset.editQuizId = id;
        showQuizForm(); // Show the form after setting up edit mode
    } catch (error) {
        console.error('Error editing quiz:', error);
        alert('Error editing quiz. Please check the console for details.');
    }
}

async function copyQuiz(id) {
    try {
        const response = await fetch(`/api/quiz/${id}/copy`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Quiz copied successfully!');
            loadQuizzes(); // Refresh quiz list
        } else {
            console.error('Copy quiz failed:', data);
            alert(`Error copying quiz: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error copying quiz:', error);
        alert('Error copying quiz. Please check the console for details.');
    }
}

async function deleteQuiz(id) {
    if (!confirm('Are you sure you want to delete this quiz? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/quiz/${id}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Quiz deleted successfully!');
            loadQuizzes(); // Refresh quiz list
        } else {
            console.error('Delete quiz failed:', data);
            alert(`Error deleting quiz: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error deleting quiz:', error);
        alert('Error deleting quiz. Please check the console for details.');
    }
}

function showWinners(leaderboard) {
    try {
        console.log('Showing winners with leaderboard:', leaderboard);
        
        const modal = document.getElementById('winnersModal');
        if (!modal) {
            throw new Error('Winners modal element not found');
        }

        const firstPlace = document.getElementById('firstPlace');
        const secondPlace = document.getElementById('secondPlace');
        const thirdPlace = document.getElementById('thirdPlace');
        const totalParticipants = document.getElementById('totalParticipants');

        if (!firstPlace || !secondPlace || !thirdPlace || !totalParticipants) {
            throw new Error('Required winner elements not found');
        }

        // Reset previous winners
        [firstPlace, secondPlace, thirdPlace].forEach(place => {
            place.classList.remove('show');
            place.querySelector('.winner-name').textContent = '';
            place.querySelector('.winner-score').textContent = '';
            place.querySelector('.winner-rank').textContent = '';
        });

        // Sort leaderboard by score
        const sortedLeaderboard = [...leaderboard].sort((a, b) => b.score - a.score);
        console.log('Sorted leaderboard:', sortedLeaderboard);

        // Update total participants
        totalParticipants.textContent = `Total Participants: ${leaderboard.length}`;

        // Update winners with rankings
        if (sortedLeaderboard.length > 0) {
            firstPlace.querySelector('.winner-name').textContent = sortedLeaderboard[0].name;
            firstPlace.querySelector('.winner-score').textContent = `Score: ${sortedLeaderboard[0].score}`;
            firstPlace.querySelector('.winner-rank').textContent = `Rank: 1/${sortedLeaderboard.length}`;
            firstPlace.classList.add('show');
        }

        if (sortedLeaderboard.length > 1) {
            secondPlace.querySelector('.winner-name').textContent = sortedLeaderboard[1].name;
            secondPlace.querySelector('.winner-score').textContent = `Score: ${sortedLeaderboard[1].score}`;
            secondPlace.querySelector('.winner-rank').textContent = `Rank: 2/${sortedLeaderboard.length}`;
            secondPlace.classList.add('show');
        }

        if (sortedLeaderboard.length > 2) {
            thirdPlace.querySelector('.winner-name').textContent = sortedLeaderboard[2].name;
            thirdPlace.querySelector('.winner-score').textContent = `Score: ${sortedLeaderboard[2].score}`;
            thirdPlace.querySelector('.winner-rank').textContent = `Rank: 3/${sortedLeaderboard.length}`;
            thirdPlace.classList.add('show');
        }

        // Add full leaderboard
        const leaderboardList = document.getElementById('fullLeaderboard');
        if (leaderboardList) {
            leaderboardList.innerHTML = sortedLeaderboard
                .map((participant, index) => `
                    <div class="leaderboard-entry ${index < 3 ? 'top-three' : ''}">
                        <span class="rank">${index + 1}/${sortedLeaderboard.length}</span>
                        <span class="name">${participant.name}</span>
                        <span class="score">${participant.score}</span>
                        <div class="stats">
                            <span class="answered">${participant.answeredQuestions || 0} answered</span>
                            <span class="correct">${participant.correctAnswers || 0} correct</span>
                        </div>
                    </div>
                `).join('');
        }

        // Show modal
        modal.style.display = 'block';
        console.log('Winners modal displayed successfully');
    } catch (error) {
        console.error('Error showing winners:', error);
        alert('Error displaying winners. Please check the console for details.');
    }
}

function closeWinnersModal() {
    const modal = document.getElementById('winnersModal');
    const winners = document.querySelectorAll('.winner');
    winners.forEach(winner => winner.classList.remove('show'));
    modal.style.display = 'none';
    showQuizzes();
}
