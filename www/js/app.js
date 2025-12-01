// --- Firebase Modular Imports (The correct way to load v11) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL APP STATE & UTILITIES ---
let currentView = 'home';
let db, auth, userId;
let gardenListenerSetup = false;
let quizState = { active: false, currentQuizType: null, questions: [], score: 0, currentQuestionIndex: 0 };

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

setLogLevel('Debug'); // Enable Firebase debug logging

// --- FIXED QUIZ DATA (REPLACING AI GENERATION) ---
const FIXED_QUIZZES = {
    ionic: [
        {
            question: "What is the typical range of valence electrons for a Metal atom, such as Sodium?",
            options: ["4 to 7", "0 or 8", "1 to 3", "2 to 4"],
            correctAnswer: "1 to 3"
        },
        {
            question: "Ionic bonds are formed when atoms...",
            options: ["Share valence electrons.", "Are both nonmetals.", "Transfer valence electrons.", "Are both noble gases."],
            correctAnswer: "Transfer valence electrons."
        },
        {
            question: "When a metal loses an electron, it becomes a...",
            options: ["Negative ion (anion)", "Neutral atom", "Covalent bond", "Positive ion (cation)"],
            correctAnswer: "Positive ion (cation)"
        }
    ],
    covalent: [
        {
            question: "Covalent bonds primarily form between which types of atoms?",
            options: ["A metal and a nonmetal", "Two metals", "Two nonmetals", "Noble gases"],
            correctAnswer: "Two nonmetals"
        },
        {
            question: "How do atoms achieve stability in a covalent bond, like in water (H₂O)?",
            options: ["By gaining electrons", "By sharing valence electrons", "By transferring electrons completely", "By becoming positive ions"],
            correctAnswer: "By sharing valence electrons"
        },
        {
            question: "In the molecule Water (H₂O), how many valence electrons does Oxygen share in total?",
            options: ["Zero", "Four", "One", "Two"],
            correctAnswer: "Two" // Shares one with each H
        }
    ]
};


// --- FIREBASE/FIRESTORE LOGIC ---

async function initializeFirebase() {
    if (!firebaseConfig) {
        document.getElementById('user-status').textContent = 'Auth Failed (No Config)';
        return;
    }

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    try {
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
    } catch (error) {
        console.error("Firebase Authentication failed:", error);
        document.getElementById('user-status').textContent = 'Auth Failed';
        // Fallback: Use a unique ID if auth fails
        userId = crypto.randomUUID();
        return;
    }

    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            document.getElementById('user-status').textContent = `User ID: ${userId.substring(0, 8)}...`;
            exposedUpdateMoleculeGardenButton();
        } else {
            document.getElementById('user-status').textContent = 'Signed Out';
        }
    });
}

// --- MOLECULE GARDEN ACCESS CONTROL ---
const MOLECULE_GARDEN_UNLOCKED = "moleculeGardenUnlocked";

function updateMoleculeGardenButton() {
    const isUnlocked = localStorage.getItem(MOLECULE_GARDEN_UNLOCKED) === 'true';
    const btnHome = document.getElementById('btn-molecule-home');

    if (btnHome) {
        btnHome.disabled = !isUnlocked;
        btnHome.textContent = isUnlocked ? 'Start Calm Lab' : 'LOCKED (Complete Quiz)';
        btnHome.classList.toggle('bg-gray-400', !isUnlocked);
        btnHome.classList.toggle('hover:bg-gray-500', !isUnlocked);
        btnHome.classList.toggle('bg-[var(--color-primary-soft)]', isUnlocked);
    }
}
const exposedUpdateMoleculeGardenButton = updateMoleculeGardenButton;

// --- NAVIGATION & VIEW MANAGEMENT ---
function setView(viewName) {
    currentView = viewName;
    const views = document.querySelectorAll('.view');
    views.forEach(view => view.classList.add('hidden'));

    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) {
        targetView.classList.remove('hidden');
    }

    // Manage 3D animation visibility
    if (viewName === 'home') {
        if (typeof initThree === 'function' && typeof animate === 'function') {
            if (!window.animationFrameId) {
                initThree();
                animate();
            }
        }
    } else {
        if (window.animationFrameId) {
            cancelAnimationFrame(window.animationFrameId);
            window.animationFrameId = null;
        }
    }

    // Start Molecule Garden listener if navigating to it
    if (viewName === 'molecule' && !gardenListenerSetup && userId) {
        window.setupRealtimeGardenListener();
    }

    // Re-initialize Forces & Motion if navigating to it
    if (viewName === 'forces') {
        window.setupForcesListeners();
    }
}

// --- 3D ANIMATION (THREE.JS) - HOMEPAGE ---
let scene, camera, renderer, molecule;
const threeContainer = document.getElementById('three-container');
window.animationFrameId = null;

function initThree() {
    // Check if renderer exists (prevent multiple initializations)
    if (renderer) return;

    scene = new THREE.Scene();

    // Set size based on container for responsiveness
    const width = threeContainer.clientWidth;
    const height = 150;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    threeContainer.appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 5;

    const ambientLight = new THREE.AmbientLight(0xdddddd, 1.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    molecule = new THREE.Group();
    scene.add(molecule);

    const mat1 = new THREE.MeshPhongMaterial({ color: 0x81A29D, shininess: 30 }); // Soft Blue-Green
    const mat2 = new THREE.MeshPhongMaterial({ color: 0xB7C8C5, shininess: 30 }); // Lighter Accent

    const atom1 = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), mat1);
    const atom2 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 32), mat2);
    const atom3 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 32), mat2);

    atom1.position.set(0, 0, 0);
    atom2.position.set(1.5, 0.5, 0);
    atom3.position.set(-1.5, -0.5, 0);

    function createBond(start, end) {
        const distance = start.position.distanceTo(end.position);
        const geometry = new THREE.CylinderGeometry(0.1, 0.1, distance, 8);
        const material = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 10 });
        const bond = new THREE.Mesh(geometry, material);

        bond.position.set((start.position.x + end.position.x) / 2, (start.position.y + end.position.y) / 2, (start.position.z + end.position.z) / 2);
        bond.lookAt(start.position);
        bond.rotation.x += Math.PI / 2;
        return bond;
    }

    const bond1 = createBond(atom1, atom2);
    const bond2 = createBond(atom1, atom3);

    molecule.add(atom1, atom2, atom3, bond1, bond2);

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    if (threeContainer.clientWidth > 0) {
        const width = threeContainer.clientWidth;
        const height = 150;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
}

function animate() {
    window.animationFrameId = requestAnimationFrame(animate);

    if (molecule) {
        molecule.rotation.x += 0.001;
        molecule.rotation.y += 0.002;
    }

    if (renderer) {
        renderer.render(scene, camera);
    }
}

// --- MODAL UTILITIES ---
function showModal(message) {
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-container').classList.remove('hidden');
}

function hideModal() {
    document.getElementById('modal-container').classList.add('hidden');
}

// --- ACCESSBILITY UTILITIES ---
function toggleAccessibility() {
    document.getElementById('accessibility-menu').classList.toggle('hidden');
}

function applyAccessibility() {
    const body = document.body;
    const highContrastCheckbox = document.getElementById('highContrast');
    const dyslexicFontCheckbox = document.getElementById('dyslexicFont');

    if (highContrastCheckbox.checked) {
        body.classList.add('high-contrast');
    } else {
        body.classList.remove('high-contrast');
    }

    if (dyslexicFontCheckbox.checked) {
        body.style.fontFamily = "Verdana, Arial, sans-serif";
        body.classList.add('dyslexia-font');
    } else {
        body.style.fontFamily = "'Nunito', 'Inter', sans-serif";
        body.classList.remove('dyslexia-font');
    }
}

// --- INITIALIZATION ---
// Expose functions globally for HTML attributes (FIX 2)
window.setView = setView;
window.toggleAccessibility = toggleAccessibility;
window.applyAccessibility = applyAccessibility;
window.showModal = showModal;
window.hideModal = hideModal;

// This is the core application setup function called after module load
function setupApp() {
    initializeFirebase();

    // Manually show only the first view and hide the rest
    const views = document.querySelectorAll('.view');
    views.forEach(view => {
        if (view.id !== 'view-home') {
            view.classList.add('hidden');
        }
    });

    // Init Three.js and start animation loop
    initThree(); // Calling local function
    animate(); // Calling local function

    // Setup listeners for Molecule Garden
    setupMoleculeListeners();

    // Initial setup for Forces & Motion 
    setupForcesListeners();

    // Set initial state for Molecule Garden lock
    exposedUpdateMoleculeGardenButton();
}


// --- MOLECULE GARDEN LOGIC ---

// Firestore Persistence
function getMoleculeGardenDocRef(uid) {
    return doc(db,
        'artifacts', appId,
        'public', 'data',
        'molecule_gardens', uid);
}

async function saveMoleculeGarden(gardenState) {
    if (!db || !userId) {
        console.warn("Database not ready or User not signed in. Cannot save.");
        return;
    }
    try {
        await setDoc(getMoleculeGardenDocRef(userId), {
            molecules: gardenState,
            lastUpdated: serverTimestamp(),
            userId: userId,
            visibility: 'public'
        }, { merge: true });
        console.log("Garden saved successfully.");
    } catch (e) {
        console.error("Error adding document: ", e);
    }
}

window.setupRealtimeGardenListener = function () {
    if (!db || !userId || gardenListenerSetup) return;

    const unsub = onSnapshot(getMoleculeGardenDocRef(userId), (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            const molecules = data.molecules || [];
            updateGardenUI(molecules);
        } else {
            console.log("No existing garden data found, starting fresh.");
            updateGardenUI([]);
        }
    }, (error) => {
        console.error("Error listening to garden data:", error);
        showModal("Error reading your saved progress.");
    });
    gardenListenerSetup = true; // Flag to prevent multiple listeners
    console.log("Molecule Garden listener started.");
}

// Game Data
const atoms = {
    H: { name: 'Hydrogen', valency: 1, color: 'text-gray-400', emoji: '⚪' },
    O: { name: 'Oxygen', valency: 2, color: 'text-red-500', emoji: '🔴' },
    C: { name: 'Carbon', valency: 4, color: 'text-green-500', emoji: '🟢' },
    N: { name: 'Nitrogen', valency: 3, color: 'text-blue-500', emoji: '🔵' }
};

const recipes = [
    { name: "Water (H₂O)", atoms: { H: 2, O: 1 }, result: '🌊' },
    { name: "Carbon Dioxide (CO₂)", atoms: { C: 1, O: 2 }, result: '💨' },
    { name: "Methane (CH₄)", atoms: { C: 1, H: 4 }, result: '🔥' }
];

let currentMolecule = {};
let discoveredMolecules = [];

// Simple Audio Generator (Click sound)
function playClickSound() {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, context.currentTime); // A4
    gainNode.gain.setValueAtTime(0.1, context.currentTime);

    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.1);
    oscillator.stop(context.currentTime + 0.1);
}

function addAtom(symbol) {
    currentMolecule[symbol] = (currentMolecule[symbol] || 0) + 1;
    updateCurrentMoleculeUI();
}

function resetMolecule() {
    currentMolecule = {};
    document.getElementById('current-molecule').innerHTML = '<p class="text-gray-400">Drag or click atoms here to start a new molecule.</p>';
    document.getElementById('valency-status').textContent = 'Total Valency: 0 (Must be even and balanced)';
    document.getElementById('result-text').textContent = '';
}

function updateCurrentMoleculeUI() {
    const container = document.getElementById('current-molecule');
    container.innerHTML = '';
    let valencyUsed = 0;

    for (const atomSymbol in currentMolecule) {
        const count = currentMolecule[atomSymbol];
        const atomInfo = atoms[atomSymbol];
        valencyUsed += atomInfo.valency * count;

        const atomElement = document.createElement('div');
        atomElement.className = `${atomInfo.color} text-4xl font-bold inline-block p-2`;
        atomElement.textContent = `${atomInfo.emoji} x${count}`;
        container.appendChild(atomElement);
    }

    document.getElementById('valency-status').textContent = `Total Valency: ${valencyUsed} (Must be even and balanced)`;
    checkMolecule();
}

function checkMolecule() {
    const valencyTotal = Object.entries(currentMolecule).reduce((sum, [symbol, count]) =>
        sum + atoms[symbol].valency * count, 0);

    if (valencyTotal === 0) {
        document.getElementById('result-text').textContent = '';
        return;
    }

    if (valencyTotal % 2 !== 0) {
        document.getElementById('result-text').textContent = 'Valency is unbalanced. Keep building...';
        document.getElementById('result-text').className = 'text-red-500 font-medium';
        return;
    }

    for (const recipe of recipes) {
        let matches = true;
        const recipeAtoms = recipe.atoms;

        // Check if atom counts match exactly
        for (const symbol in recipeAtoms) {
            if (currentMolecule[symbol] !== recipeAtoms[symbol]) {
                matches = false; break;
            }
        }
        for (const symbol in currentMolecule) {
            if (currentMolecule[symbol] !== recipeAtoms[symbol]) {
                matches = false; break;
            }
        }

        if (matches) {
            handleDiscovery(recipe);
            return;
        }
    }

    document.getElementById('result-text').textContent = 'Stable, but not a known molecule. Try tweaking the ratio.';
    document.getElementById('result-text').className = 'text-yellow-600 font-medium';
}

function handleDiscovery(recipe) {
    if (!discoveredMolecules.some(m => m.name === recipe.name)) {
        discoveredMolecules.push(recipe);
        document.getElementById('result-text').textContent = `${recipe.result} Success! You discovered ${recipe.name}! ${recipe.result}`;
        document.getElementById('result-text').className = 'text-emerald-600 font-bold text-xl animate-pulse';
        saveMoleculeGarden(discoveredMolecules);
    } else {
        document.getElementById('result-text').textContent = `${recipe.name} already in your garden. Reset to try another!`;
        document.getElementById('result-text').className = 'text-gray-600 font-medium';
    }
}

function updateGardenUI(molecules) {
    discoveredMolecules = molecules;
    const garden = document.getElementById('molecule-garden-ui');
    garden.innerHTML = '';

    if (molecules.length === 0) {
        garden.innerHTML = '<p class="text-gray-500 italic">Your molecular garden is empty. Start bonding atoms!</p>';
    } else {
        molecules.forEach(mol => {
            const card = document.createElement('div');
            card.className = 'p-3 bg-white border border-gray-100 rounded-lg shadow-sm';
            card.innerHTML = `<span class="text-3xl">${mol.result}</span> <span class="font-semibold text-gray-700">${mol.name}</span>`;
            garden.appendChild(card);
        });
    }
}

// Drag and Drop Logic
function handleDrop(event) {
    event.preventDefault();
    const symbol = event.dataTransfer.getData("atom-symbol");
    if (symbol) {
        addAtom(symbol);
    }
}

function exposedHandleDragStart(event, symbol) {
    event.dataTransfer.setData("atom-symbol", symbol);
}

function setupMoleculeListeners() {
    const dropTarget = document.getElementById('current-molecule-container');
    if (dropTarget) {
        dropTarget.addEventListener('dragover', (e) => e.preventDefault());
        dropTarget.addEventListener('drop', handleDrop);
    }
}

// --- FORCES & MOTION LOGIC (DRAG-BASED RAMP) ---

const simulatorCanvas = document.getElementById('simulator-canvas');
const ramp = document.getElementById('ramp');
const block = document.getElementById('moving-block');
const angleValueDisplay = document.getElementById('angle-value');
const resultText = document.getElementById('forces-result-text');
const rampHandle = document.getElementById('ramp-handle');

// Simulation constants
const SVG_WIDTH = 800;
const SVG_HEIGHT = 450;
const START_X = 50; // Apex/Handle X coordinate
const END_X = 750; // Base X coordinate
const BASE_Y = 400; // Base Y coordinate
const MAX_HEIGHT_Y = 250; // Highest Y coordinate the handle can go (Approx 23.2 deg)
const BLOCK_WIDTH = 30;

let isHandleDragging = false;
let currentAngle = 0;

// Helper to convert screen coordinates to SVG coordinates
function getSvgCoords(clientX, clientY) {
    const rect = simulatorCanvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * SVG_WIDTH;
    const y = (clientY - rect.top) / rect.height * SVG_HEIGHT;
    return { x, y };
}

// Updates ramp geometry, angle display, and block reset position
function updateRampGeometry(newY) {
    // Clamp the new Y position to ensure it stays within bounds
    const clampedY = Math.min(Math.max(newY, MAX_HEIGHT_Y), BASE_Y);

    // Update the handle position
    rampHandle.setAttribute('cy', clampedY);

    // Points: (START_X, clampedY), (END_X, BASE_Y), (START_X, BASE_Y)
    ramp.setAttribute('points', `${START_X},${clampedY} ${END_X},${BASE_Y} ${START_X},${BASE_Y}`);

    // Calculate the angle based on the new height
    const height = BASE_Y - clampedY;
    const length = END_X - START_X;

    // Angle = atan(Height / Base Length)
    const angleRad = Math.atan(height / length);
    currentAngle = angleRad * (180 / Math.PI);

    // Update UI
    angleValueDisplay.textContent = currentAngle.toFixed(1);
    resultText.style.opacity = 0;

    // Reset block to the apex of the ramp
    positionBlockOnRamp(clampedY);
}

// Function to apply block position and rotation at the apex
function positionBlockOnRamp(clampedY) {
    // Block position starts at START_X (50) and clampedY - BLOCK_WIDTH
    const blockX = START_X;
    const blockY = clampedY - BLOCK_WIDTH;

    // Rotation center is the bottom-right corner of the block for the slide animation
    const blockCenterX = blockX + BLOCK_WIDTH;
    const blockCenterY = clampedY;

    // Rotate the block to match the ramp angle
    const targetTransform = `translate(0 0) rotate(-${currentAngle}, ${blockCenterX}, ${blockCenterY})`;

    // Reset transition for snap-to-position
    block.style.transition = 'none';
    block.setAttribute('x', blockX);
    block.setAttribute('y', blockY);
    block.setAttribute('transform', targetTransform);

    // Re-enable smooth transition after a small delay
    setTimeout(() => {
        block.style.transition = 'transform 3s ease-in-out';
    }, 50);
}

function handleRampDragStart(event) {
    if (event.target.id === 'ramp-handle') {
        isHandleDragging = true;
        rampHandle.style.cursor = 'grabbing';
        if (event.type.startsWith('touch')) {
            event.preventDefault();
        }
    }
}

function handleDragMove(event) {
    if (isHandleDragging) {
        const clientY = event.clientY || (event.touches ? event.touches[0].clientY : null);
        if (clientY === null) return;
        const svgCoords = getSvgCoords(0, clientY);
        updateRampGeometry(svgCoords.y);
    }
}

function handleDragEnd() {
    if (isHandleDragging) {
        isHandleDragging = false;
        rampHandle.style.cursor = 'grab';
    }
}

// Attach global listeners for movement and release
document.addEventListener('mousemove', handleDragMove);
document.addEventListener('mouseup', handleDragEnd);
document.addEventListener('touchmove', handleDragMove);
document.addEventListener('touchend', handleDragEnd);

function runSimulation() {
    if (currentAngle < 1) {
        showModal("The ramp is too flat (less than 1°). The block won't move much!");
        return;
    }
    playClickSound();

    // 1. Calculate the distance along the ramp (hypotenuse)
    const height = BASE_Y - parseFloat(rampHandle.getAttribute('cy'));
    const base = END_X - START_X;
    const hypotenuse = Math.sqrt(height * height + base * base);

    // 2. Calculate final block position on the ground (END_X)
    const finalX = END_X - BLOCK_WIDTH;
    const finalY = BASE_Y - BLOCK_WIDTH;

    // 3. The simulation duration (clamped)
    const angleRad = currentAngle * (Math.PI / 180);
    const accelerationFactor = Math.sin(angleRad);
    const duration = 5 / (accelerationFactor * 0.5 + 0.5); // Fixed distance, variable speed
    const clampedDuration = Math.min(Math.max(duration, 0.5), 5); // 0.5s to 5s

    // 4. Apply the final transform: Translate along the hypotenuse vector
    // We calculate the required shift from the starting X, Y to the final X, Y
    const startX = parseFloat(block.getAttribute('x'));
    const startY = parseFloat(block.getAttribute('y'));

    const dx = finalX - startX;
    const dy = finalY - startY;

    // The translation applied needs to move the block from (startX, startY) to (finalX, finalY)
    // It must also reset the rotation to 0 to make it look like it lands flat
    const finalTransform = `translate(${dx} ${dy}) rotate(0, ${finalX + 15}, ${finalY + 15})`;

    block.style.transitionDuration = `${clampedDuration.toFixed(2)}s`;
    block.style.transitionTimingFunction = 'ease-in'; // Simulate gravity
    block.setAttribute('transform', finalTransform);

    // 5. Display Feedback
    resultText.style.opacity = 0;
    setTimeout(() => {
        let message;
        let color;
        if (currentAngle < 7) {
            message = `Low Angle (${currentAngle.toFixed(1)}°): Slow slide. Duration: ${clampedDuration.toFixed(1)}s.`;
            color = "#F59E0B";
        } else if (currentAngle < 18) {
            message = `Moderate Angle (${currentAngle.toFixed(1)}°): Clear acceleration. Duration: ${clampedDuration.toFixed(1)}s.`;
            color = "#10B981";
        } else {
            message = `High Angle (${currentAngle.toFixed(1)}°): Fastest slide. Duration: ${clampedDuration.toFixed(1)}s.`;
            color = "#EF4444";
        }

        resultText.textContent = message;
        resultText.setAttribute('fill', color);
        resultText.style.opacity = 1;
        block.style.transitionTimingFunction = 'ease-in-out'; // Reset timing function for future use
    }, clampedDuration * 1000);

    // 6. Reset the simulation after a pause
    setTimeout(() => {
        block.style.transition = 'none';
        updateRampGeometry(parseFloat(rampHandle.getAttribute('cy')));
    }, clampedDuration * 1000 + 3000);
}

// --- Initializer for Forces section ---
function setupForcesListeners() {
    // Initial ramp setup to MAX height (approx 23.2 degrees)
    updateRampGeometry(MAX_HEIGHT_Y);
}

// --- FIXED QUIZ LOGIC (REPLACING AI GENERATION) ---

let quizRunning = false;

function loadFixedQuiz(quizType) {
    if (quizRunning) return;

    quizState.active = true;
    quizState.currentQuizType = quizType;
    quizState.questions = FIXED_QUIZZES[quizType];
    quizState.score = 0;
    quizState.currentQuestionIndex = 0;
    quizRunning = true;

    const targetButton = document.getElementById(`btn-${quizType}-quiz-start`);
    if (targetButton) {
        targetButton.style.display = 'none';
    }

    startQuiz();
}

function startQuiz() {
    const quizAreaId = `${quizState.currentQuizType}-quiz-area`;
    document.getElementById(quizAreaId).innerHTML = '';
    showNextQuestion();
}

function showNextQuestion() {
    const questionIndex = quizState.currentQuestionIndex;
    const questionData = quizState.questions[questionIndex];
    const quizAreaId = `${quizState.currentQuizType}-quiz-area`;
    const targetArea = document.getElementById(quizAreaId);

    if (!questionData) {
        return endQuiz();
    }

    // Shuffle options for better quiz experience
    const shuffledOptions = questionData.options.sort(() => Math.random() - 0.5);

    let html = `<h5 class="text-md font-bold mb-3">Question ${questionIndex + 1}/${quizState.questions.length}:</h5>`;
    html += `<p class="mb-4 text-gray-700">${questionData.question}</p>`;
    html += `<div class="space-y-2">`;

    shuffledOptions.forEach((option, index) => {
        // Ensure options are properly escaped for use in data-attribute and function call
        const cleanOption = option.replace(/'/g, "\\'");
        html += `<button onclick="checkAnswer('${cleanOption}')"
                class="w-full text-left p-3 border border-gray-200 rounded-lg hover:bg-indigo-50 transition duration-150 text-gray-700 bg-white shadow-sm quiz-option"
                data-option="${cleanOption}">
                ${option}
            </button>`;
    });

    html += `</div>`;
    targetArea.innerHTML = html;
}

function checkAnswer(selectedOption) {
    if (!quizState.active) return;

    const questionData = quizState.questions[quizState.currentQuestionIndex];
    const isCorrect = selectedOption === questionData.correctAnswer;
    const optionButtons = document.querySelectorAll(`#${quizState.currentQuizType}-quiz-area .quiz-option`);
    const feedbackElement = document.getElementById(`${quizState.currentQuizType}-feedback`);

    // Find the correct option and the selected option by their data-option attribute
    optionButtons.forEach(btn => {
        btn.disabled = true;
        const btnOption = btn.getAttribute('data-option');
        if (btnOption === questionData.correctAnswer) {
            btn.classList.add('bg-emerald-200', 'font-bold');
        } else if (btnOption === selectedOption) {
            btn.classList.add('bg-red-200', 'line-through');
        }
    });

    if (isCorrect) {
        quizState.score++;
        feedbackElement.textContent = `Correct! (${quizState.score}/${quizState.currentQuestionIndex + 1})`;
        feedbackElement.classList.remove('text-red-500');
        feedbackElement.classList.add('text-emerald-600');
    } else {
        feedbackElement.textContent = `Incorrect. The correct answer is: ${questionData.correctAnswer}`;
        feedbackElement.classList.remove('text-emerald-600');
        feedbackElement.classList.add('text-red-500');
    }

    // Move to next question after a brief delay
    setTimeout(() => {
        quizState.currentQuestionIndex++;
        showNextQuestion();
    }, 1500);
}

function endQuiz() {
    const quizType = quizState.currentQuizType;
    const targetArea = document.getElementById(`${quizType}-quiz-area`);
    const targetButtonStart = document.getElementById(`btn-${quizType}-quiz-start`);
    const feedbackElement = document.getElementById(`${quizType}-feedback`);

    const score = quizState.score;
    const total = quizState.questions.length;
    const scorePercentage = (score / total) * 100;

    if (targetButtonStart) {
        targetButtonStart.textContent = 'Start New Quiz';
        targetButtonStart.style.display = 'block'; // Show button again
    }
    quizRunning = false;
    quizState.active = false;

    if (targetArea) {
        targetArea.innerHTML = `<h5 class="text-xl font-bold text-center mb-3">Quiz Complete!</h5>
                                        <p class="text-center text-2xl font-extrabold text-indigo-600">${score}/${total}</p>
                                        <p class="text-center text-sm text-gray-600">Score: ${scorePercentage.toFixed(0)}%</p>`;
    }

    if (feedbackElement) {
        feedbackElement.textContent = ''; // Clear temporary feedback
    }

    // --- UNLOCK LOGIC ---
    if (quizType === 'covalent' && scorePercentage >= 66) { // Unlock on 2/3 correct
        localStorage.setItem(MOLECULE_GARDEN_UNLOCKED, 'true');
        showModal("Success! You've mastered Covalent Bonding. Molecule Garden is now unlocked on the homepage!");
        exposedUpdateMoleculeGardenButton();
        document.getElementById('covalent-unlock-message').classList.add('hidden');
    } else if (quizType === 'covalent') {
        const unlockMessage = document.getElementById('covalent-unlock-message');
        if (unlockMessage) {
            unlockMessage.classList.remove('hidden');
            unlockMessage.textContent = 'Score at least 66% to unlock Molecule Garden!';
        }
    }
}


// --- GLOBAL EXPOSURE (Ensure inline HTML calls work) ---
// Functions called directly in HTML need to be defined here or exposed.
window.setView = setView;
window.toggleAccessibility = toggleAccessibility;
window.applyAccessibility = applyAccessibility;
window.showModal = showModal;
window.hideModal = hideModal;
window.initThree = initThree;
window.animate = animate;
window.addAtom = addAtom;
window.resetMolecule = resetMolecule;
window.checkAnswer = checkAnswer;
window.loadFixedQuiz = loadFixedQuiz;
window.startQuiz = startQuiz;
window.runSimulation = runSimulation;
window.handleRampDragStart = handleRampDragStart;


// Final, most robust initializer
window.onload = function () {
    setupApp();
};

