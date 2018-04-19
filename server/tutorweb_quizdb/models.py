import sqlalchemy as sa
from sqlalchemy.ext.declarative import declared_attr
from pluserable.data.models import (
    GroupBase, UserBase)
from pluserable.data.sqlalchemy.models import (
    ActivationMixin)

from tutorweb_quizdb import Base

ACTIVE_HOST_DOMAIN = 'overriden_in_init'


class User(UserBase, Base):
    __tablename__ = 'user'
    __table_args__ = dict(
        extend_existing=True,
    )

    @classmethod
    def active_host_domain(cls):
        """
        Return the host_domain currently in use
        """
        return ACTIVE_HOST_DOMAIN

    host_domain = sa.Column(
        'hostdomain',
        sa.UnicodeText,
        default=ACTIVE_HOST_DOMAIN,
        primary_key=True)
    id = sa.Column(
        'user_id',
        sa.Integer,
        autoincrement=True,
        primary_key=True)

    username = sa.Column("user_name", sa.UnicodeText)
    _password = sa.Column('pw_hash', sa.Unicode(256), nullable=False)

    # Ignore any csrf_token passed through
    @property
    def csrf_token(self):
        pass

    @csrf_token.setter
    def csrf_token(self, value):
        pass


class Group(GroupBase, Base):
    __tablename__ = 'group'
    __table_args__ = dict(
        extend_existing=True,
    )

    @declared_attr
    def id(cls):
        """Autogenerated ID"""
        return sa.Column(
            'group_id',
            sa.Integer,
            autoincrement=True,
            primary_key=True)


class UserGroup(Base):
    __tablename__ = 'user_group'
    __table_args__ = dict(
        extend_existing=True,
    )

    @declared_attr
    def id(cls):
        """Autogenerated ID"""
        return sa.Column(
            'user_group_id',
            sa.Integer,
            autoincrement=True,
            primary_key=True)


class Activation(ActivationMixin, Base):
    __tablename__ = 'activation'
    __table_args__ = dict(
        extend_existing=True,
    )

    @declared_attr
    def id(cls):
        """Autogenerated ID"""
        return sa.Column(
            'activation_id',
            sa.Integer,
            autoincrement=True,
            primary_key=True)
