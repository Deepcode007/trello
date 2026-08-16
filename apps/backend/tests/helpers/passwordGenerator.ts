import * as crypto from 'crypto';

export function generateTestPassword()
{
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = uppercase + lowercase + numbers + special;

    // Use crypto for secure random selection
    const getRandomChar = (charSet: string)=>
    {
        const randomIndex = crypto.randomInt(0, charSet.length);
        return charSet[randomIndex];
    };

    // 1. Guarantee the 4 required types are present (4 characters)
    const passwordArray = [
        getRandomChar(uppercase),
        getRandomChar(lowercase),
        getRandomChar(numbers),
        getRandomChar(special)
    ];

    // 2. Fill the remaining 6 slots to make it exactly 10 characters
    for (let i = 0; i < 6; i++)
    {
        passwordArray.push(getRandomChar(allChars));
    }

    // 3. Shuffle the array using Fisher-Yates so the pattern isn't predictable
    for (let i = passwordArray.length - 1; i > 0; i--)
    {
        const j = crypto.randomInt(0, i + 1);
        [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
    }

    return passwordArray.join('');
}

// Example output: "pG4!xK9_mQ" (Exactly 10 characters, passes all schema rules)
