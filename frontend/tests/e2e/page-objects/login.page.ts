import { Page, expect } from '@playwright/test';

/**
 * Page object for the login flow.
 */
export class LoginPage {
  constructor(private page: Page) {}

  /**
   * Navigate to the sign-in page.
   */
  async goto(): Promise<void> {
    await this.page.goto('/sign-in');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Fill in email field.
   */
  async fillEmail(email: string): Promise<void> {
    await this.page.getByLabel(/email/i).fill(email);
  }

  /**
   * Fill in password field.
   */
  async fillPassword(password: string): Promise<void> {
    await this.page.getByLabel(/password/i).fill(password);
  }

  /**
   * Click the sign in button.
   */
  async clickSignIn(): Promise<void> {
    await this.page.getByRole('button', { name: /sign in/i }).click();
  }

  /**
   * Perform complete login flow.
   */
  async login(email: string, password: string): Promise<void> {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.clickSignIn();
  }

  /**
   * Check if MFA is required.
   * Waits for either MFA prompt or redirect to org page.
   */
  async isMfaRequired(): Promise<boolean> {
    // Wait for either MFA prompt or successful redirect
    const mfaText = this.page.getByText('Two-factor authentication');
    const orgRedirect = this.page.waitForURL(/\/organizations\//, { timeout: 5000 }).catch(() => null);

    // Race between MFA appearing and redirect happening
    const result = await Promise.race([
      mfaText.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'mfa'),
      orgRedirect.then(() => 'redirect'),
    ]).catch(() => 'timeout');

    return result === 'mfa';
  }

  /**
   * Handle MFA if required.
   */
  async handleMfa(code: string): Promise<void> {
    const mfaInput = this.page.getByLabel(/verification code/i);
    await mfaInput.fill(code);
    await this.page.getByRole('button', { name: /verify/i }).click();
  }

  /**
   * Wait for successful login (redirect to organization page).
   */
  async waitForLoginSuccess(timeout = 30000): Promise<void> {
    await this.page.waitForURL(/\/organizations\//, { timeout });
  }

  /**
   * Complete login flow including MFA handling.
   */
  async loginWithMfa(
    email: string,
    password: string,
    mfaCode?: string
  ): Promise<void> {
    await this.login(email, password);

    if (await this.isMfaRequired()) {
      if (!mfaCode) {
        throw new Error('MFA required but no code provided');
      }
      await this.handleMfa(mfaCode);
    }

    await this.waitForLoginSuccess();
  }

  /**
   * Expect sign in button to be visible.
   */
  async expectSignInButtonVisible(): Promise<void> {
    await expect(
      this.page.getByRole('button', { name: /sign in/i })
    ).toBeVisible();
  }

  /**
   * Expect error message to be visible.
   */
  async expectErrorMessage(message: string | RegExp): Promise<void> {
    await expect(this.page.getByText(message)).toBeVisible();
  }

  /**
   * Click forgot password link.
   */
  async clickForgotPassword(): Promise<void> {
    await this.page.getByRole('link', { name: /forgot password/i }).click();
  }

  /**
   * Click sign up link.
   */
  async clickSignUp(): Promise<void> {
    await this.page.getByRole('link', { name: /sign up/i }).click();
  }
}
