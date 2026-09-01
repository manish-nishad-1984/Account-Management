import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createUserSchema, updateUserSchema, type UserDetail } from "@accountmanagement/contracts";
import {
  Alert,
  CheckboxField,
  FormDialog,
  FormSection,
  MultiSelectField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { useAssignmentOptions, useCreateUser, useUpdateUser, useUser } from "./api";

/**
 * The user form.
 *
 * Create and edit use DIFFERENT schemas, which is unusual here and deliberate:
 * a create requires a password, an edit must be able to leave it alone. Making
 * one schema serve both would mean an optional password on create, and the
 * failure mode of that is a user created with no credential at all.
 *
 * Nothing on this screen ever displays a password. The .NET user endpoints
 * return `User.Password` — the plaintext — to the browser (assessment C-1); the
 * API here does not select the column on any read path, so there is nothing to
 * show even by accident.
 */
type CreateValues = z.input<typeof createUserSchema>;
type CreateSubmitted = z.output<typeof createUserSchema>;

export function UserFormDialog({
  open,
  userId,
  onClose,
}: {
  open: boolean;
  userId: string | null;
  onClose: () => void;
}) {
  const isEdit = userId !== null;
  const detail = useUser(open && isEdit ? userId : null);
  const options = useAssignmentOptions(open);
  const create = useCreateUser();
  const update = useUpdateUser();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors },
  } = useForm<CreateValues, unknown, CreateSubmitted>({
    // On edit the password is optional, so the create schema — which requires it
    // — would refuse every save that did not change it.
    resolver: zodResolver((isEdit ? updateUserSchema : createUserSchema) as never),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
      reset(EMPTY);
    } else if (detail.data) {
      reset(toFormValues(detail.data));
    }
  }, [open, isEdit, detail.data, reset]);

  const pending = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (isEdit) {
        // An empty password field means "leave it alone", not "set it to empty".
        const { password, ...rest } = values;
        await update.mutateAsync({
          id: userId,
          body: password ? { ...rest, password } : rest,
        });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  }, (invalid) => setFormError(unshownValidationMessage(invalid)));

  const siteOptions = (options.data?.sites ?? []).map((site) => ({
    value: site.id,
    label: site.name,
  }));
  const companyOptions = (options.data?.companies ?? []).map((company) => ({
    value: company.id,
    label: company.name,
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit user" : "Add user"}
      description="Sign-in details, and the sites and companies this person may act on"
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create user"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading user…</p>
      ) : (
        <>
          <FormSection title="Person">
            <TextField
              label="First name"
              required
              autoFocus
              error={errors.firstName?.message}
              {...register("firstName")}
            />
            <TextField
              label="Last name"
              required
              error={errors.lastName?.message}
              {...register("lastName")}
            />
            <TextField
              label="Email"
              type="email"
              required
              error={errors.email?.message}
              {...register("email")}
            />
            <TextField
              label="Phone"
              inputMode="tel"
              required
              hint="10 digits, starting 6-9"
              error={errors.phoneNo?.message}
              {...register("phoneNo")}
            />
          </FormSection>

          <FormSection title="Sign-in">
            <TextField
              label="Username"
              required
              hint="Matched without regard to case"
              error={errors.userName?.message}
              {...register("userName")}
            />
            <TextField
              label={isEdit ? "New password" : "Password"}
              type="password"
              required={!isEdit}
              autoComplete="new-password"
              hint={
                isEdit
                  ? "Leave blank to keep the current password"
                  : "At least 12 characters, using three of: lower case, upper case, digits, symbols"
              }
              error={errors.password?.message}
              {...register("password")}
            />
            <CheckboxField
              label="Active"
              hint="An inactive user cannot sign in"
              className="sm:col-span-2"
              {...register("isActive")}
            />

            {isEdit && detail.data?.passwordIsLegacy && (
              <Alert tone="warning" className="sm:col-span-2">
                This account still holds the plaintext password carried over from
                SQL Server. Setting a password here hashes it and clears that
                flag — as does the user's next successful sign-in.
              </Alert>
            )}
          </FormSection>

          {/*
            These two replace `User.SiteId` and `User.CompanyId`, which are CSV
            STRINGS in SQL Server parsed at every call site. They are junction
            tables here, so an assignment to a site that no longer exists is
            refused by a foreign key rather than sitting in a string forever.
          */}
          <FormSection title="Access" columns={2}>
            <Controller
              control={control}
              name="siteIds"
              render={({ field }) => (
                <MultiSelectField
                  label="Sites"
                  options={siteOptions}
                  value={(field.value as string[] | undefined) ?? []}
                  onChange={field.onChange}
                  error={errors.siteIds?.message}
                  emptyMessage={options.isLoading ? "Loading sites…" : "No sites yet"}
                />
              )}
            />
            <Controller
              control={control}
              name="companyIds"
              render={({ field }) => (
                <MultiSelectField
                  label="Companies"
                  options={companyOptions}
                  value={(field.value as string[] | undefined) ?? []}
                  onChange={field.onChange}
                  error={errors.companyIds?.message}
                  emptyMessage={options.isLoading ? "Loading companies…" : "No companies yet"}
                />
              )}
            />
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}

const EMPTY: CreateValues = {
  userName: "",
  firstName: "",
  lastName: "",
  email: "",
  phoneNo: "",
  password: "",
  isActive: true,
  siteIds: [],
  companyIds: [],
};

const toFormValues = (detail: UserDetail): CreateValues => ({
  userName: detail.userName,
  firstName: detail.firstName,
  lastName: detail.lastName,
  email: detail.email,
  phoneNo: detail.phoneNo,
  // Always blank on edit: there is nothing to prefill it with, and a masked
  // placeholder would submit as a password change.
  password: "",
  isActive: detail.isActive,
  siteIds: detail.siteIds,
  companyIds: detail.companyIds,
});
