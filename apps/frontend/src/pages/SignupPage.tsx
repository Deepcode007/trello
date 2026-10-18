import React from "react";
import { AuthLayout } from "../components/auth/AuthLayout";
import { SignupForm } from "../components/auth/SignupForm";

export function SignupPage()
{
    return (
        <AuthLayout
            title="Create your account"
            subtitle="Get started with real-time Kanban boards in seconds."
        >
            <SignupForm />
        </AuthLayout>
    );
}

export default SignupPage;
