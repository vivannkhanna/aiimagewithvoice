document.addEventListener('DOMContentLoaded', () => {
    const startRecordButton = document.getElementById('startRecord');
    const stopRecordButton = document.getElementById('stopRecord');
    const statusDiv = document.getElementById('status');
    const playerDiv = document.getElementById('player');
    const consentModal = document.getElementById('consentModal');
    const consentAgree = document.getElementById('consentAgree');
    const consentDecline = document.getElementById('consentDecline');

    let mediaRecorder;
    let audioChunks = [];

    consentModal.style.display = 'flex';

    // consent stuff
    consentAgree.addEventListener('click', () => {
        consentModal.style.display = 'none';
        startRecordButton.disabled = false;
    });

    consentDecline.addEventListener('click', () => {
        consentModal.style.display = 'none';
        statusDiv.textContent = 'You declined consent. You can\'t record audio.';
    });

    startRecordButton.addEventListener('click', () => {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                mediaRecorder = new MediaRecorder(stream);
                mediaRecorder.ondataavailable = event => {
                    audioChunks.push(event.data);
                };
                mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'recording.wav');

                    try {
                        const response = await fetch('/upload', {
                            method: 'POST',
                            body: formData
                        });

                        if (response.ok) {
                            const data = await response.json();
                            statusDiv.textContent = 'Transcription: ' + data.transcription;

                            // deletes prior image
                            const previousImage = playerDiv.querySelector('img');
                            if (previousImage) {
                                playerDiv.removeChild(previousImage);
                            }

                            const imgElement = document.createElement('img');
                            imgElement.src = data.imageUrl;
                            imgElement.alt = 'Generated Image';
                            imgElement.style.maxWidth = '100%';
                            playerDiv.appendChild(imgElement);
                        } else {
                            statusDiv.textContent = 'Error in transcription or image generation.';
                        }
                    } catch (error) {
                        console.error('Error uploading audio:', error);
                        statusDiv.textContent = 'Error in transcription or image generation.';
                    }
                };
                mediaRecorder.start(1000);
                statusDiv.textContent = 'Recording...';
                startRecordButton.disabled = true;
                stopRecordButton.disabled = false;
            })
            .catch(error => {
                statusDiv.textContent = 'Error accessing microphone.';
                console.error(error);
            });
    });

    stopRecordButton.addEventListener('click', () => {
        mediaRecorder.stop();
        statusDiv.textContent = 'Processing...';
        startRecordButton.disabled = false;
        stopRecordButton.disabled = true;
    });
});