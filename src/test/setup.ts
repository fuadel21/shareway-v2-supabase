import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });
