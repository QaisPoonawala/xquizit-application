const Quiz = require('../models/Quiz');
const Participant = require('../models/Participant');
const xlsx = require('xlsx');
const path = require('path');

// Create a new quiz
exports.createQuiz = async (req, res) => {
    try {
        // Enhanced logging
        console.log('Received quiz creation request');
        console.log('Request body:', JSON.stringify(req.body, null, 2));

        // Validate required fields
        if (!req.body.title) {
            console.error('Quiz creation failed: Missing title');
            return res.status(400).json({
                success: false,
                error: 'Quiz title is required'
            });
        }

        // Ensure questions are in the correct format
        const quizData = {
            title: req.body.title,
            description: req.body.description || '',
            questions: req.body.questions || [],
            theme: req.body.theme || {
                backgroundColor: '#ffffff',
                textColor: '#333333',
                accentColor: '#007bff'
            }
        };

        // Detailed logging of processed quiz data
        console.log('Processed quiz data:', JSON.stringify(quizData, null, 2));

        try {
            const quiz = await Quiz.create(quizData);
            console.log('Quiz created successfully:', JSON.stringify(quiz, null, 2));
            
            res.status(201).json({
                success: true,
                data: quiz
            });
        } catch (createError) {
            console.error('DynamoDB create error:', createError);
            res.status(500).json({
                success: false,
                error: 'Failed to create quiz in database',
                details: createError.message,
                stack: createError.stack
            });
        }
    } catch (error) {
        console.error('Unexpected error in quiz creation:', error);
        res.status(500).json({
            success: false,
            error: 'Unexpected error occurred',
            details: error.message,
            stack: error.stack
        });
    }
};

// Copy quiz
exports.copyQuiz = async (req, res) => {
    try {
        const originalQuiz = await Quiz.findById(req.params.id);
        if (!originalQuiz) {
            return res.status(404).json({
                success: false,
                error: 'Quiz not found'
            });
        }

        // Create new quiz with same content but different title
        const newQuiz = await Quiz.create({
            title: `${originalQuiz.title} (Copy)`,
            description: originalQuiz.description,
            theme: originalQuiz.theme,
            questions: originalQuiz.questions,
            originalQuizId: originalQuiz.id
        });

        res.status(201).json({
            success: true,
            data: newQuiz
        });
    } catch (error) {
        console.error('Error copying quiz:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

// Get all quizzes
exports.getQuizzes = async (req, res) => {
    try {
        console.log('Getting all quizzes');
        const quizzes = await Quiz.find({ archived: 0 });
        console.log('Found quizzes:', quizzes);
        res.status(200).json({
            success: true,
            count: quizzes.length,
            data: quizzes
        });
    } catch (error) {
        console.error('Error getting quizzes:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

// Get archived quizzes
exports.getArchivedQuizzes = async (req, res) => {
    try {
        const quizzes = await Quiz.find({ archived: 1 });
        res.status(200).json({
            success: true,
            count: quizzes.length,
            data: quizzes
        });
    } catch (error) {
        console.error('Error getting archived quizzes:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

// Get single quiz
exports.getQuiz = async (req, res) => {
    try {
        const quiz = await Quiz.findById(req.params.id);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                error: 'Quiz not found'
            });
        }
        res.status(200).json({
            success: true,
            data: quiz
        });
    } catch (error) {
        console.error('Error getting quiz:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

// Update quiz
exports.updateQuiz = async (req, res) => {
    try {
        const quiz = await Quiz.findByIdAndUpdate(req.params.id, req.body);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                error: 'Quiz not found'
            });
        }
        res.status(200).json({
            success: true,
            data: quiz
        });
    } catch (error) {
        console.error('Error updating quiz:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

// Delete quiz
exports.deleteQuiz = async (req, res) => {
    try {
        const quiz = await Quiz.findByIdAndDelete(req.params.id);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                error: 'Quiz not found'
            });
        }
        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        console.error('Error deleting quiz:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

// Start quiz
exports.startQuiz = async (req, res) => {
    try {
        const sessionCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const quiz = await Quiz.startQuiz(req.params.id, sessionCode);
        if (!quiz) {
            return res.status(404).json({ success: false, message: 'Quiz not found' });
        }

        // Emit initial participant count
        const io = req.app.get('io');
        io.to(quiz.id.toString()).emit('participant-count', { count: 0 });

        res.json({ 
            success: true, 
            data: { 
                sessionCode: quiz.sessionCode 
            } 
        });
    } catch (error) {
        console.error('Error starting quiz:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// End quiz
exports.endQuiz = async (req, res) => {
    try {
        console.log('Starting endQuiz process for quiz ID:', req.params.id);

        // 1. Find and validate quiz
        const quiz = await Quiz.findById(req.params.id);
        if (!quiz) {
            console.error('Quiz not found:', req.params.id);
            return res.status(404).json({ success: false, message: 'Quiz not found' });
        }
        console.log('Found quiz:', JSON.stringify(quiz, null, 2));

        // 2. Get participants
        console.log('Getting participants for quiz:', quiz.id);
        const participants = await Participant.findByQuizId(quiz.id);
        console.log('Found participants:', JSON.stringify(participants, null, 2));

        // 3. Handle no participants case
        if (!participants || participants.length === 0) {
            console.log('No participants found, ending quiz without results');
            try {
                const updatedQuiz = await Quiz.endQuiz(req.params.id, []);
                console.log('Quiz ended successfully with no participants');
                return res.json({ success: true, data: updatedQuiz });
            } catch (error) {
                console.error('Error ending quiz with no participants:', error);
                throw error;
            }
        }
        
        // 4. Process participant results
        console.log('Processing participants results...');
        const currentResults = participants.map(participant => {
            console.log('Processing participant:', participant.name);
            return {
                participantName: participant.name || '',
                score: participant.score || 0,
                completedAt: new Date().toISOString(),
                answers: (participant.answers || []).map(answer => {
                    console.log('Processing answer:', answer);
                    return {
                        questionIndex: answer.questionIndex,
                        answeredAt: answer.answeredAt,
                        isCorrect: answer.isCorrect === true || answer.isCorrect === 1 ? 1 : 0,
                        timeTaken: answer.timeTaken,
                        points: answer.points || 0,
                        answer: answer.answer
                    };
                })
            };
        });

        // 5. Calculate winners with detailed stats
        console.log('Calculating winners...');
        const sortedResults = [...currentResults].sort((a, b) => b.score - a.score);
        const winners = sortedResults.map((result, index) => ({
            name: result.participantName,
            score: result.score,
            answeredQuestions: result.answers.length,
            correctAnswers: result.answers.filter(a => a.isCorrect === 1).length,
            rank: index + 1
        }));
        console.log('Winners:', JSON.stringify(winners, null, 2));

        // 6. Archive results
        console.log('Archiving results:', JSON.stringify(currentResults, null, 2));
        const updatedQuiz = await Quiz.endQuiz(req.params.id, currentResults);
        console.log('Quiz ended successfully:', JSON.stringify(updatedQuiz, null, 2));

        // 7. Notify connected clients via Socket.IO
        const io = req.app.get('io');
        if (io) {
            console.log('Emitting quiz-ended event to room:', quiz.id.toString());
            io.to(quiz.id.toString()).emit('quiz-ended', {
                results: currentResults,
                winners: winners
            });
        }

        res.json({ 
            success: true, 
            data: {
                ...updatedQuiz,
                winners: winners
            }
        });
    } catch (error) {
        console.error('Error ending quiz:', {
            error: error.message,
            stack: error.stack,
            quizId: req.params.id
        });
        res.status(500).json({ 
            success: false, 
            message: error.message,
            details: error.stack
        });
    }
};

// Export quiz results
exports.exportQuizResults = async (req, res) => {
    try {
        console.log('Starting export for quiz ID:', req.params.id);
        
        const quiz = await Quiz.findById(req.params.id);
        console.log('Quiz data:', JSON.stringify(quiz, null, 2));

        if (!quiz) {
            console.error('Quiz not found:', req.params.id);
            return res.status(404).json({ success: false, message: 'Quiz not found' });
        }

        // Create workbook
        const wb = xlsx.utils.book_new();
        
        try {
            // Participant results worksheet
            const archivedResults = quiz.archivedResults || [];
            console.log('Archived results:', JSON.stringify(archivedResults, null, 2));
            
            const participantData = archivedResults.map(result => ({
                'Participant Name': result.participantName || 'Unknown',
                'Total Score': result.score || 0,
                'Completed At': result.completedAt ? new Date(result.completedAt).toLocaleString() : 'N/A'
            }));
            const participantWs = xlsx.utils.json_to_sheet(participantData);
            xlsx.utils.book_append_sheet(wb, participantWs, 'Participants');

            // Questions worksheet
            const questions = quiz.questions || [];
            console.log('Questions:', JSON.stringify(questions, null, 2));
            
            const questionData = questions.map((q, idx) => {
                const questionAnswers = archivedResults.flatMap(r => 
                    (r.answers || []).filter(a => a.questionIndex === idx)
                );
                
                const correctOption = q.options.find(o => o.isCorrect === 1 || o.isCorrect === true);
                
                return {
                    'Question': q.questionText || 'Unknown Question',
                    'Correct Option': correctOption ? correctOption.text : 'N/A',
                    'All Options': (q.options || []).map(o => o.text).join(', '),
                    'Total Attempts': questionAnswers.length,
                    'Correct Answers': questionAnswers.filter(a => a.isCorrect === 1 || a.isCorrect === true).length,
                    'Average Time (seconds)': questionAnswers.length > 0 ? 
                        Math.round(questionAnswers.reduce((acc, curr) => acc + (curr.timeTaken || 0), 0) / questionAnswers.length) : 0,
                    'Success Rate': questionAnswers.length > 0 ? 
                        `${Math.round((questionAnswers.filter(a => a.isCorrect === 1 || a.isCorrect === true).length / questionAnswers.length) * 100)}%` : '0%'
                };
            });
            const questionWs = xlsx.utils.json_to_sheet(questionData);
            xlsx.utils.book_append_sheet(wb, questionWs, 'Questions');

            // Detailed answers worksheet
            const answerData = archivedResults.flatMap(result => 
                (result.answers || []).map(answer => {
                    const question = questions[answer.questionIndex] || {};
                    const option = question.options ? question.options[answer.answer] : null;
                    
                    return {
                        'Participant': result.participantName || 'Unknown',
                        'Question': question.questionText || 'Unknown Question',
                        'Answer': option ? option.text : 'Invalid Answer',
                        'Correct': (answer.isCorrect === 1 || answer.isCorrect === true) ? 'Yes' : 'No',
                        'Time Taken (seconds)': answer.timeTaken || 0,
                        'Points': answer.points || 0
                    };
                })
            );
            const answerWs = xlsx.utils.json_to_sheet(answerData);
            xlsx.utils.book_append_sheet(wb, answerWs, 'Detailed Answers');
        } catch (processError) {
            console.error('Error processing quiz data:', processError);
            throw new Error(`Error processing quiz data: ${processError.message}`);
        }

        // Generate Excel file
        const filename = `quiz-results-${quiz.id}.xlsx`;
        const filePath = path.join(__dirname, '..', 'public', 'exports', filename);
        console.log('Writing file to:', filePath);
        
        try {
            xlsx.writeFile(wb, filePath);
            console.log('File written successfully');
            
            // Verify file exists
            const fs = require('fs');
            if (fs.existsSync(filePath)) {
                console.log('File exists after writing');
            } else {
                console.error('File does not exist after writing');
            }
            
            res.json({
                success: true,
                data: {
                    downloadUrl: `/exports/${filename}`
                }
            });
        } catch (writeError) {
            console.error('Error writing file:', writeError);
            throw writeError;
        }
    } catch (error) {
        console.error('Error exporting quiz results:', {
            error: error.message,
            stack: error.stack,
            quizId: req.params.id
        });
        res.status(500).json({ 
            success: false, 
            message: error.message,
            details: error.stack 
        });
    }
};

// Update participant score
exports.updateParticipantScore = async (req, res) => {
    try {
        const { quizId, participantId, score } = req.body;
        
        const quiz = await Quiz.findById(quizId);
        if (!quiz || !quiz.isLive) {
            return res.status(404).json({ success: false, message: 'Active quiz not found' });
        }

        const participantIndex = quiz.activeParticipants.findIndex(
            p => p.participantId === participantId
        );

        if (participantIndex === -1) {
            return res.status(404).json({ success: false, message: 'Participant not found' });
        }

        quiz.activeParticipants[participantIndex].score = score;
        const updatedQuiz = await Quiz.updateActiveParticipants(quizId, quiz.activeParticipants);

        res.json({ success: true, data: updatedQuiz.activeParticipants });
    } catch (error) {
        console.error('Error updating participant score:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
